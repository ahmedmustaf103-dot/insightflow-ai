import type { AnalysisResult } from "@/lib/analysis/types";
import { formatValue, resultHeader } from "@/lib/analysis/present";

export function ResultTable({ result }: { result: AnalysisResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[18rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-muted">
            {result.columns.map((column) => (
              <th key={column.name} scope="col" className="px-3 py-3 text-xs font-medium">
                {resultHeader(column.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, index) => (
            <tr key={index} className="border-b border-line last:border-0">
              {result.columns.map((column, columnIndex) => {
                const value = row[column.name];
                const text = formatValue(column.name, value ?? null);
                return (
                  <td key={column.name} className="px-3 py-3.5 tabular-nums">
                    {columnIndex === 0 ? (
                      <span className="flex items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper text-xs font-semibold text-accent">
                          {text.slice(0, 1)}
                        </span>
                        <span className="font-medium">{text}</span>
                      </span>
                    ) : (
                      text
                    )}
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
