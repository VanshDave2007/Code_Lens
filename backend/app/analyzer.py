from __future__ import annotations

import ast
from collections import Counter
from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class Finding:
    rule_id: str
    title: str
    severity: str
    line: int
    column: int
    category: str
    description: str
    explanation: str
    recommendation: str


class CodeVisitor(ast.NodeVisitor):
    def __init__(self, source: str, function_limit: int = 25, nesting_limit: int = 3):
        self.source = source
        self.lines = source.splitlines()
        self.function_limit = function_limit
        self.nesting_limit = nesting_limit
        self.findings: list[Finding] = []
        self.functions: list[dict[str, Any]] = []
        self.imports: list[tuple[str, int]] = []
        self.used_names: Counter[str] = Counter()
        self.assigned: list[tuple[str, int]] = []
        self.classes = 0
        self.conditions = 0
        self.loops = 0
        self.calls = 0
        self.returns = 0
        self.max_nesting = 0
        self.nesting = 0

    def add(self, rule_id: str, title: str, severity: str, node: ast.AST, category: str, description: str, explanation: str, recommendation: str) -> None:
        self.findings.append(Finding(rule_id, title, severity, getattr(node, "lineno", 1), getattr(node, "col_offset", 0) + 1, category, description, explanation, recommendation))

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self.imports.append((alias.asname or alias.name.split(".")[0], node.lineno))
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        for alias in node.names:
            self.imports.append((alias.asname or alias.name, node.lineno))
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, ast.Load):
            self.used_names[node.id] += 1
        elif isinstance(node.ctx, (ast.Store, ast.Del)):
            self.assigned.append((node.id, node.lineno))
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.classes += 1
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        end = getattr(node, "end_lineno", node.lineno)
        length = end - node.lineno + 1
        complexity = function_complexity(node)
        has_docstring = ast.get_docstring(node) is not None
        self.functions.append({"name": node.name, "line": node.lineno, "end_line": end, "length": length, "complexity": complexity, "docstring": has_docstring, "arguments": len(node.args.args)})
        if length > self.function_limit:
            self.add("CL001", f"Long function: {node.name}()", "medium", node, "quality", f"This function contains {length} lines.", "Long functions often mix several responsibilities and are harder to test.", "Extract one focused task into a helper function.")
        if not has_docstring:
            self.add("CL003", f"Missing docstring: {node.name}()", "low", node, "documentation", "This function has no docstring.", "A docstring gives readers a quick explanation of a function's purpose.", f'Add a short docstring below `def {node.name}(...):`.')
        if complexity >= 8:
            self.add("CL006", f"High complexity: {node.name}()", "high", node, "complexity", f"Cyclomatic complexity is {complexity}.", "Many decisions create more execution paths to understand and test.", "Split conditions into smaller named functions or use early returns.")
        if len(node.args.args) > 5:
            self.add("CL008", f"Many parameters: {node.name}()", "low", node, "quality", f"This function takes {len(node.args.args)} parameters.", "A long parameter list can make calls hard to read.", "Group related values into an object or configuration structure.")
        self.generic_visit(node)

    visit_AsyncFunctionDef = visit_FunctionDef

    def _nested(self, node: ast.AST) -> None:
        self.nesting += 1
        self.max_nesting = max(self.max_nesting, self.nesting)
        if self.nesting > self.nesting_limit:
            self.add("CL002", "Deep nesting detected", "medium", node, "complexity", f"This block reaches nesting level {self.nesting}.", "Deep nesting makes it difficult to follow which condition applies.", "Use an early return or extract the nested code into a helper function.")
        self.generic_visit(node)
        self.nesting -= 1

    def visit_If(self, node: ast.If) -> None:
        self.conditions += 1
        self._nested(node)

    def visit_For(self, node: ast.For) -> None:
        self.loops += 1
        self._nested(node)

    visit_AsyncFor = visit_For

    def visit_While(self, node: ast.While) -> None:
        self.loops += 1
        self._nested(node)

    def visit_Try(self, node: ast.Try) -> None:
        self.conditions += len(node.handlers)
        for handler in node.handlers:
            if handler.type is None:
                self.add("CL011", "Broad exception handler", "low", handler, "quality", "This `except` catches every exception.", "It can hide unexpected problems and make debugging harder.", "Catch the specific exception you expect to handle.")
            if not handler.body or all(isinstance(x, ast.Pass) for x in handler.body):
                self.add("CL010", "Empty exception handler", "medium", handler, "quality", "This exception handler does not do anything.", "Silently ignoring an error can conceal an important problem.", "Handle the error, log it, or explain why it is safe to ignore.")
        self._nested(node)

    def visit_Call(self, node: ast.Call) -> None:
        self.calls += 1
        if isinstance(node.func, ast.Name) and node.func.id == "print":
            self.add("CL012", "Debug print statement", "info", node, "quality", "This file contains a print statement.", "Print is useful while learning, but production code often uses structured logging.", "Keep it if it is intentional output; otherwise remove it before sharing the code.")
        self.generic_visit(node)

    def visit_Return(self, node: ast.Return) -> None:
        self.returns += 1
        self.generic_visit(node)


def function_complexity(node: ast.AST) -> int:
    return 1 + sum(isinstance(child, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler, ast.IfExp, ast.Match)) for child in ast.walk(node))


def analyze_code(source: str, file_name: str = "main.py", settings: dict[str, int] | None = None) -> dict[str, Any]:
    settings = settings or {}
    try:
        tree = ast.parse(source, filename=file_name)
    except SyntaxError as error:
        return {"ok": False, "syntax_error": {"line": error.lineno or 1, "column": error.offset or 1, "message": error.msg, "text": error.text or ""}, "findings": [], "metrics": {"loc": len(source.splitlines()), "functions": 0, "classes": 0, "imports": 0, "complexity": 0}, "health": {"score": 0, "label": "Critical", "syntax": 0, "quality": 0, "complexity": 0, "documentation": 0, "maintainability": 0}, "structure": []}
    visitor = CodeVisitor(source, int(settings.get("function_limit", 25)), int(settings.get("nesting_limit", 3)))
    visitor.visit(tree)
    for name, line in visitor.imports:
        if visitor.used_names[name] == 0:
            visitor.findings.append(Finding("CL004", f"Unused import: {name}", "low", line, 1, "quality", f"`{name}` is imported but never used.", "Unused imports make a file harder to scan.", "Remove the import if it is no longer needed."))
    ignored = {"_", "self", "cls"}
    for name, line in visitor.assigned:
        if name not in ignored and not name.startswith("_") and visitor.used_names[name] == 0:
            visitor.findings.append(Finding("CL005", f"Unused variable: {name}", "low", line, 1, "quality", f"`{name}` is assigned but never read.", "Unused variables can signal leftover code or a missing step.", "Remove it or use it where intended."))
    for no, line in enumerate(visitor.lines, 1):
        if "TODO" in line or "FIXME" in line:
            visitor.findings.append(Finding("CL013", "TODO/FIXME marker", "info", no, 1, "quality", "This line contains a TODO or FIXME note.", "It marks unfinished work to revisit.", "Resolve it or add enough context for the next person."))
    loc = sum(bool(line.strip()) for line in visitor.lines)
    if loc > int(settings.get("file_limit", 250)):
        visitor.findings.append(Finding("CL007", "Large file", "medium", 1, 1, "structure", f"This file has {loc} non-empty lines.", "Large files can become difficult to navigate and maintain.", "Split independent responsibilities into modules."))
    docs = round(100 * sum(f["docstring"] for f in visitor.functions) / len(visitor.functions)) if visitor.functions else 100
    high = sum(f.severity in {"critical", "high"} for f in visitor.findings)
    medium = sum(f.severity == "medium" for f in visitor.findings)
    quality = max(20, 100 - high * 16 - medium * 9 - sum(f.severity == "low" for f in visitor.findings) * 3)
    avg_complexity = round(sum(f["complexity"] for f in visitor.functions) / len(visitor.functions), 1) if visitor.functions else 1
    complexity_score = max(20, round(100 - max(0, avg_complexity - 2) * 12 - max(0, visitor.max_nesting - 2) * 8))
    maintainability = round((quality + complexity_score + docs) / 3)
    score = round(quality * .30 + complexity_score * .25 + docs * .20 + maintainability * .25)
    label = "Excellent" if score >= 90 else "Good" if score >= 75 else "Needs Improvement" if score >= 60 else "Poor" if score >= 40 else "Critical"
    structure = build_structure(tree)
    return {"ok": True, "syntax_error": None, "findings": [asdict(f) for f in sorted(visitor.findings, key=lambda x: (x.line, x.rule_id))], "metrics": {"loc": loc, "functions": len(visitor.functions), "classes": visitor.classes, "imports": len(visitor.imports), "conditions": visitor.conditions, "loops": visitor.loops, "calls": visitor.calls, "returns": visitor.returns, "complexity": round(avg_complexity, 1), "max_nesting": visitor.max_nesting, "function_details": visitor.functions}, "health": {"score": score, "label": label, "syntax": 100, "quality": quality, "complexity": complexity_score, "documentation": docs, "maintainability": maintainability}, "structure": structure}


def build_structure(tree: ast.AST) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = ", ".join(a.name for a in node.names)
            items.append({"type": "import", "name": names, "line": node.lineno, "children": []})
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            children = [{"type": type(x).__name__.replace("Async", "").replace("Def", "").lower(), "name": "", "line": getattr(x, "lineno", node.lineno)} for x in ast.walk(node) if isinstance(x, (ast.If, ast.For, ast.While, ast.Return, ast.Call))]
            items.append({"type": "function", "name": node.name, "line": node.lineno, "children": children[:20]})
        elif isinstance(node, ast.ClassDef):
            items.append({"type": "class", "name": node.name, "line": node.lineno, "children": []})
    return items
