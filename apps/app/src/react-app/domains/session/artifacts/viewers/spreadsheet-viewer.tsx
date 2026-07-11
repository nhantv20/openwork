/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PreviewLoading, PreviewError, PreviewUnavailable } from "../preview";

interface SpreadsheetViewerProps {
  url: string;
  title: string;
  className?: string;
}

interface SheetData {
  name: string;
  rows: string[][];
}

const MAX_ROWS = 1000;
const MAX_COLS = 50;

export function SpreadsheetViewer({ url, title, className }: SpreadsheetViewerProps) {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((res) => res.arrayBuffer())
      .then(async (buf) => {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        const data: SheetData[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const ref = ws["!ref"];
          if (!ref) return { name, rows: [] };
          const range = XLSX.utils.decode_range(ref);
          const rows: string[][] = [];
          const startRow = Math.max(range.s.r, 0);
          const endRow = Math.min(range.e.r, startRow + MAX_ROWS - 1);
          const startCol = Math.max(range.s.c, 0);
          const endCol = Math.min(range.e.c, startCol + MAX_COLS - 1);
          for (let r = startRow; r <= endRow; r++) {
            const row: string[] = [];
            for (let c = startCol; c <= endCol; c++) {
              const cellRef = XLSX.utils.encode_cell({ r, c });
              const cell = ws[cellRef];
              row.push(cell ? String(cell.v ?? "") : "");
            }
            rows.push(row);
          }
          return { name, rows };
        });
        if (!cancelled) {
          setSheets(data);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [url]);

  if (loading) return <PreviewLoading className={className} />;
  if (error) return <PreviewError message={error} className={className} />;
  if (sheets.length === 0) return <PreviewUnavailable className={className} />;

  const current = sheets[activeSheet];

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {sheets.length > 1 && (
        <div className="flex shrink-0 gap-1 border-b border-border bg-muted/30 px-2 py-1">
          {sheets.map((sheet, idx) => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheet(idx)}
              className={cn(
                "rounded-sm px-3 py-1 text-xs",
                activeSheet === idx
                  ? "bg-primary/15 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {current.rows.map((row, rIdx) => (
              <tr key={rIdx} className="border-b border-border hover:bg-muted/30">
                <td className="sticky left-0 w-10 border-r border-border bg-muted/50 px-1 text-right text-muted-foreground">
                  {rIdx + 1}
                </td>
                {row.map((cell, cIdx) => (
                  <td
                    key={cIdx}
                    className={cn(
                      "min-w-[80px] max-w-[300px] truncate border-r border-border px-2 py-1",
                      typeof Number(cell) === "number" && !isNaN(Number(cell)) && cell.trim() !== ""
                        ? "text-right"
                        : "",
                    )}
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="shrink-0 border-t border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
        {current.rows.length} rows × {current.rows[0]?.length ?? 0} columns
        {sheets.length > 1 && ` · Sheet ${activeSheet + 1} of ${sheets.length}`}
      </div>
    </div>
  );
}