# CodeLens

Local-first Python learning and code-analysis tool. It pairs a developer-style workspace with AST-powered analysis, controlled Python execution, local SQLite history, and PDF/JSON/Markdown reporting.

## Run locally

1. Install Python 3.11+.
2. Open a terminal in `backend/` and run `python -m pip install -r requirements.txt`.
3. Start the API with `python -m uvicorn app.main:app --reload --port 8000`.
4. Open `index.html` in a browser.

When the API is online, the UI uses actual AST analysis, real controlled Python execution, SQLite history, and branded PDF report generation. It retains an in-browser analysis fallback if the backend is not running.

## Safety note

Execution uses an isolated temporary working directory, a short timeout, no administrator privileges, and output trimming. It is a reasonable student-project safeguard, not a security sandbox for hostile code.

## Tests

From `backend/`, run `python -m pytest tests`.
