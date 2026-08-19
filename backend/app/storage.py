from __future__ import annotations

import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "codelens.db"

def connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE IF NOT EXISTS analyses (id INTEGER PRIMARY KEY, project TEXT NOT NULL, file_name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, score INTEGER NOT NULL, findings INTEGER NOT NULL, complexity REAL NOT NULL, payload TEXT NOT NULL)")
    return conn

def save(project: str, file_name: str, analysis: dict) -> int:
    with connection() as conn:
        cursor = conn.execute("INSERT INTO analyses(project,file_name,score,findings,complexity,payload) VALUES(?,?,?,?,?,?)", (project, file_name, analysis["health"]["score"], len(analysis["findings"]), analysis["metrics"]["complexity"], json.dumps(analysis)))
        return int(cursor.lastrowid)

def history() -> list[dict]:
    with connection() as conn:
        return [dict(row) for row in conn.execute("SELECT id, project, file_name, created_at, score, findings, complexity FROM analyses ORDER BY id DESC LIMIT 50")]

def get_analysis(analysis_id: int) -> dict | None:
    with connection() as conn:
        row = conn.execute("SELECT payload FROM analyses WHERE id=?", (analysis_id,)).fetchone()
        return json.loads(row["payload"]) if row else None
