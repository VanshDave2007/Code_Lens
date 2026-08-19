from __future__ import annotations

import io
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .analyzer import analyze_code
from .storage import get_analysis, history, save

app = FastAPI(title="CodeLens API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class AnalyzeRequest(BaseModel):
    code: str = Field(max_length=500_000)
    file_name: str = "main.py"
    project: str = "Default Project"
    settings: dict[str, int] = {}
    save_history: bool = True

class ExecuteRequest(BaseModel):
    code: str = Field(max_length=200_000)
    stdin: str = Field(default="", max_length=20_000)
    timeout_seconds: int = Field(default=4, ge=1, le=10)

@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "python": sys.version.split()[0], "ai": "offline - optional"}

@app.post("/analyze")
def analyze(payload: AnalyzeRequest) -> dict[str, Any]:
    result = analyze_code(payload.code, payload.file_name, payload.settings)
    if result["ok"] and payload.save_history:
        result["history_id"] = save(payload.project, payload.file_name, result)
    return result

@app.post("/execute")
def execute(payload: ExecuteRequest) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="codelens_") as directory:
        source = Path(directory) / "main.py"
        source.write_text(payload.code, encoding="utf-8")
        started = time.perf_counter()
        try:
            completed = subprocess.run([sys.executable, "-I", str(source)], input=payload.stdin, text=True, capture_output=True, cwd=directory, timeout=payload.timeout_seconds)
        except subprocess.TimeoutExpired:
            return {"ok": False, "kind": "timeout", "message": f"Execution stopped after {payload.timeout_seconds} seconds.", "output": "", "time_ms": round((time.perf_counter()-started)*1000)}
    output = (completed.stdout + completed.stderr)[:50_000]
    return {"ok": completed.returncode == 0, "kind": "completed" if completed.returncode == 0 else "runtime_error", "exit_code": completed.returncode, "output": output, "time_ms": round((time.perf_counter()-started)*1000)}

@app.get("/history")
def get_history() -> list[dict]:
    return history()

@app.get("/history/{analysis_id}")
def analysis_history(analysis_id: int) -> dict:
    item = get_analysis(analysis_id)
    if not item:
        raise HTTPException(404, "Analysis not found")
    return item

@app.post("/reports/pdf")
def report(payload: AnalyzeRequest) -> Response:
    result = analyze_code(payload.code, payload.file_name, payload.settings)
    if not result["ok"]:
        raise HTTPException(400, "Fix syntax errors before creating a report.")
    buf = io.BytesIO(); doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=18*mm, bottomMargin=18*mm)
    styles = getSampleStyleSheet(); story = [Paragraph("CODELENS", styles["Title"]), Paragraph("AI-Powered Programming Learning & Code Analysis Assistant", styles["Subtitle"]), Spacer(1, 12), Paragraph(f"<b>File:</b> {payload.file_name}", styles["BodyText"]), Paragraph(f"<b>Code Health:</b> {result['health']['score']}/100 - {result['health']['label']}", styles["BodyText"]), Spacer(1, 12)]
    data = [["Metric", "Value"], ["Lines of code", result["metrics"]["loc"]], ["Functions", result["metrics"]["functions"]], ["Classes", result["metrics"]["classes"]], ["Average complexity", result["metrics"]["complexity"]], ["Findings", len(result["findings"])]]
    table = Table(data, colWidths=[80*mm, 60*mm]); table.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#213885")),("TEXTCOLOR",(0,0),(-1,0),colors.white),("GRID",(0,0),(-1,-1),.3,colors.HexColor("#CCCACC")),("BACKGROUND",(0,1),(-1,-1),colors.HexColor("#ECDFD2")),("PADDING",(0,0),(-1,-1),7)])); story += [Paragraph("Code Statistics", styles["Heading2"]), table, Spacer(1, 14), Paragraph("Detailed Findings", styles["Heading2"])]
    for finding in result["findings"]:
        story.append(Paragraph(f"<b>{finding['severity'].upper()} - {finding['title']}</b> (line {finding['line']})", styles["BodyText"]))
        story.append(Paragraph(f"{finding['description']} {finding['recommendation']}", styles["BodyText"]))
        story.append(Spacer(1, 5))
    doc.build(story)
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=codelens-report.pdf"})
