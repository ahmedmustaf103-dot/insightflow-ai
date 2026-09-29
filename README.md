# InsightFlow AI

Ask a question about a CSV. Pandas calculates the result. Later phases will let a model plan and explain that result, without inventing numbers.

Phase 1 is the deterministic foundation: dataset profiling and a closed analysis catalog (`aggregate`, `trend`, `detail`). There is no LLM, upload UI, or database yet.

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
