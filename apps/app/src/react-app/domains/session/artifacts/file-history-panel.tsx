/** @jsxImportSource react */
/**
 * Phase 6, slice 6.4 — FileHistoryPanel.
 *
 * A small popover that lists all snapshots for the currently open file, with
 * Restore + Save snapshot + (stubbed) Compare buttons. Compare is a no-op
 * with a tooltip in this slice; slice 6.5a wires it up to the real diff
 * endpoint.
 *
 * Null-safety: when workspaceId or filePath is undefined, the hook
 * (useFileHistory) returns an empty array and the panel renders nothing.
 * This mirrors AionUi's `if (!historyTarget) return null` from
 * `usePreviewHistory.ts:145` (WBS round-1 review).
 */
import { useState } from "react";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { History, RotateCcw, Save, GitCompareArrows } from "lucide-react";
import { useFileHistory } from "./hooks/use-file-history";

type Props = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  filePath: string | null;
  /** Optional: pre-loaded file content for the "Save snapshot" form. */
  currentContent?: string;
};

function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}

export function FileHistoryPanel({ client, workspaceId, filePath, currentContent }: Props) {
  const { history, historyLoading, historyError, saveManualSnapshot, isSaving, restoreSnapshot, isRestoring } =
    useFileHistory({ client, workspaceId, filePath });
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!workspaceId || !filePath) return null;

  const onSave = async () => {
    setSaveError(null);
    try {
      await saveManualSnapshot(currentContent ?? "");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const onRestore = async (snapshotId: string) => {
    setRestoreError(null);
    try {
      await restoreSnapshot(snapshotId);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex w-80 flex-col gap-3 p-3" data-testid="file-history-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-dls-text">
          <History className="h-3.5 w-3.5" />
          <span>{filePath.split("/").pop()}</span>
        </div>
        <span className="text-[10px] text-dls-secondary">{history.length} snapshot{history.length === 1 ? "" : "s"}</span>
      </div>

      <Button
        onClick={onSave}
        disabled={isSaving || currentContent === undefined}
        size="sm"
        variant="outline"
        data-testid="file-history-save"
      >
        <Save className="mr-1 h-3 w-3" />
        {isSaving ? "Saving…" : "Save snapshot"}
      </Button>

      {saveError ? <div className="text-[11px] text-red-500">{saveError}</div> : null}
      {restoreError ? <div className="text-[11px] text-red-500">{restoreError}</div> : null}

      <div className="max-h-72 overflow-y-auto rounded-md border border-dls-border">
        {historyLoading ? (
          <div className="p-3 text-center text-[11px] text-dls-secondary">Loading…</div>
        ) : historyError ? (
          <div className="p-3 text-center text-[11px] text-red-500">{historyError.message}</div>
        ) : history.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-dls-secondary">
            No history yet — changes to this file are tracked automatically.
          </div>
        ) : (
          <ul className="divide-y divide-dls-border" data-testid="file-history-list">
            {history.map((snap) => (
              <li
                key={snap.id}
                className="flex items-center justify-between gap-2 p-2 text-[11px]"
                data-testid="file-history-row"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[10px] text-dls-text">{snap.id.slice(0, 12)}…</div>
                  <div className="text-[10px] text-dls-secondary">
                    {formatRelative(snap.createdAt)} · {snap.size} B · {snap.trigger}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void onRestore(snap.id)}
                          disabled={isRestoring}
                          aria-label="Restore snapshot"
                          data-testid="file-history-restore"
                        >
                          <RotateCcw />
                        </Button>
                      }
                    />
                    <TooltipContent>Restore file to this version</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled
                          aria-label="Compare (coming in 6.5a)"
                          data-testid="file-history-compare"
                        >
                          <GitCompareArrows />
                        </Button>
                      }
                    />
                    <TooltipContent>Compare (coming in 6.5a)</TooltipContent>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
