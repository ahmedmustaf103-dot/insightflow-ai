import type { AnalysisResponse } from "@/lib/analysis/types";
import { AnalysisChart } from "@/components/analysis-chart";
import { ResultTable } from "@/components/result-table";
import { evidenceFacts, isEmptyResult, planFacts, presentWarning } from "@/lib/analysis/present";

export function AnswerView({ response }: { response: AnalysisResponse }) {
  const empty = isEmptyResult(response.evidence.result);
  const facts = evidenceFacts(response.evidence.plan);

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:items-start">
      <div className="contents lg:flex lg:flex-col lg:gap-6">
        <section className="order-1 rounded-2xl border border-line bg-card px-5 py-6 sm:px-6 lg:order-none" aria-labelledby="answer-heading">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Answer</p>
          {empty ? (
            <>
              <h2 id="answer-heading" className="mt-3 text-2xl font-semibold tracking-tight">
                No matching records found.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">Try changing the question or filters.</p>
            </>
          ) : (
            <AnswerCopy answer={response.answer} />
          )}
          {response.warnings.length > 0 ? (
            <ul className="mt-5 space-y-2">
              {response.warnings.map((warning) => (
                <li key={warning} className="rounded-xl bg-warning-bg px-4 py-3 text-sm leading-6 text-warning">
                  {presentWarning(warning)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="order-3 rounded-2xl border border-line bg-card px-5 py-6 sm:px-6 lg:order-none" aria-labelledby="evidence-heading">
          <h2 id="evidence-heading" className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Evidence
          </h2>
          <p className="mt-3 text-lg font-medium">Analysis performed</p>
          <dl className="mt-4 divide-y divide-line border-t border-line">
            {facts.map((fact) => (
              <div key={`${fact.label}-${fact.value}`} className="grid gap-1 py-3 sm:grid-cols-[8rem_1fr] sm:gap-4">
                <dt className="text-sm text-muted">{fact.label}</dt>
                <dd className="font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>
          {empty ? null : (
            <div className="mt-6">
              <ResultTable result={response.evidence.result} />
              {response.evidence.result.truncated ? (
                <p className="mt-3 text-sm text-muted">
                  Showing the first {response.evidence.result.rowCount.toLocaleString("en-GB")} rows.
                </p>
              ) : null}
            </div>
          )}
          <details className="mt-6 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-medium">How InsightFlow analysed this</summary>
            <dl className="mt-4 divide-y divide-line border-t border-line">
              {planFacts(response.evidence.plan).map((fact) => (
                <div key={`${fact.label}-${fact.value}`} className="grid gap-1 py-3 sm:grid-cols-[8rem_1fr] sm:gap-4">
                  <dt className="text-sm text-muted">{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      </div>

      {empty ? null : (
        <section className="order-2 rounded-2xl border border-line bg-card px-5 py-6 sm:px-6 lg:order-none" aria-labelledby="chart-heading">
          <h2 id="chart-heading" className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Visualization
          </h2>
          <div className="mt-5">
            <AnalysisChart chart={response.chart} result={response.evidence.result} />
          </div>
        </section>
      )}
    </div>
  );
}

function AnswerCopy({ answer }: { answer: string }) {
  const lines = answer
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[*+-]\s+/, "").trim())
    .filter(Boolean);
  const [lead, ...rest] = lines;

  return (
    <>
      <h2 id="answer-heading" className="mt-3 text-2xl font-medium leading-9 tracking-tight">
        {lead}
      </h2>
      {rest.length > 0 ? (
        <ul className="mt-4 space-y-2 text-base leading-7">
          {rest.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
