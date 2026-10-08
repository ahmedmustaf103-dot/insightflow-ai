# InsightFlow AI

Ask a question about a CSV. Pandas calculates the answer. A model only plans the analysis and explains the result.

## Problem

Businesses often have useful CSV data but need technical knowledge to analyse it.

## Solution

InsightFlow lets users ask questions about datasets in natural language. The user uploads one CSV, asks a question, and receives an answer together with the rows, filters, and chart that support it.

## Architecture

```text
CSV
 ↓
Pandas profiling
 ↓
DatasetProfile
 ↓
Gemini structured AnalysisPlan
 ↓
Plan validation
 ↓
Closed Pandas operation catalog
 ↓
AnalysisResult
 ↓
Result validation
 ↓
Gemini explanation
 ↓
Numerical claim verification
 ↓
Deterministic chart selection
 ↓
Answer + evidence
```

Plan validation checks the plan shape, the dataset profile, and the user's intent. A plan that names a missing column is rejected. A plan that is valid on its own but answers a different question, such as summing revenue when the user asked for profit, is also rejected. Nothing is calculated until the plan still represents the request.

```text
User intent
 ↓
AI plan
 ↓
Does the plan actually answer the user's request?
 ↓
YES → execute
NO  → reject
```

```text
LLMProvider
├── MockLLMProvider
└── GeminiLLMProvider
```

## Key engineering decisions

- The LLM does not calculate numbers.
- Pandas performs the deterministic calculations.
- Arbitrary generated Python is prohibited. The model never reaches `exec`, `eval`, or a shell command.
- Plans are validated before execution.
- Results are validated before explanation.
- Numerical claims are checked before display.
- Charts are derived from validated results.
- The mock provider allows the full pipeline to be tested without an API key.
- Gemini sits behind the `LLMProvider` abstraction, alongside the mock provider.
- Only one plan repair is permitted, and a repair cannot turn an unsupported question into a different supported question.

A normal question uses two Gemini calls: one plan and one explanation. An invalid first plan adds the single repair call. That is the maximum. `GEMINI_API_KEY` stays on the server. `GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`.

## Known limitations

- CSV only
- One dataset at a time
- No authentication
- No saved history
- Limited analysis operations: aggregate, trend, and detail
- No arbitrary Python
- No derived business metrics, so profit is not inferred from revenue and cost
- No database persistence

## Setup

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
```

Requires Python 3.11+. The TypeScript runner uses `.venv/bin/python` when `PYTHON_PATH` is unset.

## App

```bash
npm run dev
```

Open the app, upload a CSV, and ask a question. `GEMINI_API_KEY` is required for live analysis. Copy `.env.example` to `.env.local` and do not commit the key.

## Checks

```bash
npm run typecheck
npm test
npm run lint
```

`npm test` runs the unit tests and the evaluation suite with `MockLLMProvider`. It never calls Gemini. With `GEMINI_API_KEY` set, `npm run test:live` runs the opted-in revenue question against `tests/fixtures/sales.csv`.

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
