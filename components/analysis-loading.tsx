export function AnalysisLoading() {
  return (
    <div role="status" aria-live="polite" className="rounded-2xl border border-line bg-card px-5 py-6 sm:px-6">
      <p className="text-lg font-medium">Analyzing your data…</p>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
        InsightFlow is planning the analysis, calculating it, and checking the answer against the result.
      </p>
      <div className="mt-5 h-1 overflow-hidden rounded-full bg-line">
        <div className="h-full w-1/3 animate-[loading_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
      </div>
    </div>
  );
}
