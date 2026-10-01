# InsightFlow AI

Ask a question about a CSV. A model plans the analysis and explains the result. Pandas calculates it.

Phase 1 profiles a CSV and runs a closed Pandas catalog (`aggregate`, `trend`, `detail`). Phase 2 orchestrates that catalog with validation and a mock model. Phase 3 adds a Gemini provider behind the same interface. There is no upload UI or database yet.

## Architecture

### Why the LLM does not calculate

The LLM produces a structured analysis plan, while deterministic Pandas operations perform the actual calculation. Gemini can read the question and the dataset profile, propose an `AnalysisPlan`, and later explain a validated `AnalysisResult`. It does not receive the raw CSV, generate Python, execute code, or choose the chart.

### Why validation exists

Plans are validated against the dataset profile before execution. Results are validated before explanation. Numerical claims are checked against the executed result before being returned. If the first plan is invalid, the orchestrator makes one repair request and then stops. A failed repair does not execute Python and does not invent an answer.

A normal question uses two Gemini calls: one plan and one explanation. An invalid first plan adds one repair call. That is the maximum.

### Provider architecture

```text
LLMProvider
├── MockLLMProvider
└── GeminiLLMProvider
```

The orchestrator depends on `LLMProvider` only, so the AI layer is replaceable and testable. Unit tests use `MockLLMProvider` and do not need an API key. `GEMINI_API_KEY` stays on the server. `GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`.

Live pipeline:

```text
question
 → Gemini plan
 → Zod validation
 → semantic plan validation
 → one repair attempt if required
 → Pandas execution
 → result validation
 → Gemini explanation
 → claim verification
 → deterministic chart selection
 → AnalysisResponse
```

## Setup

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
```

Requires Python 3.11+. The TypeScript runner uses `.venv/bin/python` when `PYTHON_PATH` is unset.

## Checks

```bash
npm run typecheck
npm test
```

`npm test` never calls Gemini. With `GEMINI_API_KEY` set, `npm run test:live` runs the opted-in revenue question against `tests/fixtures/sales.csv`. Copy `.env.example` to `.env.local` for local live runs. Do not commit the key.

## Demo

From the repository root:

```bash
.venv/bin/python python/profile.py < tests/fixtures/requests/profile.json
.venv/bin/python python/execute.py < tests/fixtures/requests/aggregate.json
.venv/bin/python python/execute.py < tests/fixtures/requests/trend-year.json
.venv/bin/python python/execute.py < tests/fixtures/requests/trend-month.json
.venv/bin/python python/execute.py < tests/fixtures/requests/detail.json
```

`aggregate.json` answers “Which products generated the most revenue in 2025?” against `tests/fixtures/sales.csv`.

Optional limits: `MAX_UPLOAD_BYTES`, `MAX_ROWS`, `MAX_RESULT_ROWS`. Defaults are 5 MB, 50,000 rows, and 100 result rows.
