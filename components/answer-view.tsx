import type { AnalysisResponse } from "@/lib/analysis/types";
import { AnalysisChart } from "@/components/analysis-chart";
import { ResultTable } from "@/components/result-table";
import { evidenceFacts, isEmptyResult, planFacts, presentWarning } from "@/lib/analysis/present";

export function AnswerView({
  response,
  narrative = true,
}: {
  response: AnalysisResponse;
  narrative?: boolean;
}) {
  const empty = isEmptyResult(response.evidence.result);
  const facts = evidenceFacts(response.evidence.plan);

  return (
    <div className="flex flex-col gap-5">
      {empty ? (
        <section className="rounded-3xl border border-line bg-card px-5 py-6 shadow-sm sm:px-6" aria-labelledby="answer-heading">
          <h2 id="answer-heading" className="text-2xl font-semibold tracking-tight">
            No matching records found.
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">Try changing the question or filters.</p>
        </section>
      ) : (
        <section className="rounded-3xl border border-line bg-card px-5 py-5 shadow-sm sm:px-6" aria-labelledby="chart-heading">
          {narrative ? <AnswerCopy answer={response.answer} /> : null}
          <h2 id="chart-heading" className={narrative ? "mt-5 text-sm font-medium text-muted" : "text-sm font-medium text-muted"}>
            Visualization
          </h2>
          <div className="mt-4">
            <AnalysisChart chart={response.chart} result={response.evidence.result} />
          </div>
        </section>
      )}

      {response.warnings.length > 0 ? (
        <ul className="space-y-2">
          {response.warnings.map((warning) => (
            <li key={warning} className="rounded-2xl bg-warning-bg px-4 py-3 text-sm leading-6 text-warning">
              {presentWarning(warning)}
            </li>
          ))}
        </ul>
      ) : null}

      <section className="rounded-3xl border border-line bg-card px-5 py-5 shadow-sm sm:px-6" aria-labelledby="evidence-heading">
        <h2 id="evidence-heading" className="text-sm font-medium text-muted">
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
          <div className="mt-4">
            <ResultTable result={response.evidence.result} />
            {response.evidence.result.truncated ? (
              <p className="mt-3 text-sm text-muted">
                Showing the first {response.evidence.result.rowCount.toLocaleString("en-GB")} rows.
              </p>
            ) : null}
          </div>
        )}
        <details className="mt-4 border-t border-line pt-4">
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
  );
}

export function AnswerCopy({ answer }: { answer: string }) {
  const lines = answer
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[*+-]\s+/, "").trim())
    .filter(Boolean);
  const [lead, ...rest] = lines;

  return (
    <>
      <h2 id="answer-heading" className="text-lg font-medium leading-7 tracking-tight">
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
