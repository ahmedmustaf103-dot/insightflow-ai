import type { DatasetProfile } from "@/lib/analysis/types";
import { columnLabel, presentWarning, typeLabel } from "@/lib/analysis/present";

export function DatasetSummary({ profile }: { profile: DatasetProfile }) {
  return (
    <section className="rounded-2xl border border-line bg-card px-5 py-5 sm:px-6" aria-labelledby="dataset-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Dataset</p>
          <h2 id="dataset-heading" className="mt-1 text-2xl font-semibold tracking-tight">
            {profile.fileName}
          </h2>
        </div>
        <p className="text-sm text-muted">
          {profile.rowCount.toLocaleString("en-GB")} rows · {profile.columns.length} columns
        </p>
      </div>
      <dl className="mt-5 divide-y divide-line border-t border-line">
        {profile.columns.map((column) => (
          <div key={column.name} className="flex items-center justify-between gap-4 py-3">
            <dt className="font-medium">{columnLabel(column.name)}</dt>
            <dd className="text-sm text-muted">{typeLabel(column.type)}</dd>
          </div>
        ))}
      </dl>
      {profile.warnings.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {profile.warnings.map((warning) => (
            <li key={warning} className="rounded-xl bg-warning-bg px-4 py-3 text-sm leading-6 text-warning">
              {presentWarning(warning)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
