import type { AnalysisResult } from "@/lib/analysis/types";
import { formatValue, resultHeader } from "@/lib/analysis/present";

export function ResultTable({ result }: { result: AnalysisResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[18rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-muted">
            {result.columns.map((column) => (
              <th key={column.name} scope="col" className="px-3 py-3 font-medium">
                {resultHeader(column.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, index) => (
            <tr key={index} className="border-b border-line last:border-0">
              {result.columns.map((column) => {
                const value = row[column.name];
                return (
                  <td key={column.name} className="px-3 py-3 tabular-nums">
                    {formatValue(column.name, value ?? null)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
