/** @jsxImportSource react */
/**
 * Phase 6, slice 6.4 + 6.5a + 6.5b — FileHistoryPanel.
 *
 * A small popover with 2 tabs:
 *   - History (per-file snapshot list, Save/Restore/Compare buttons)
 *   - All changes (workspace-wide list of files with at least 1 snapshot)
 *
 * Null-safety: when workspaceId or filePath is undefined, the hook
 * (useFileHistory) returns an empty array and the panel renders nothing.
 * This mirrors AionUi's `if (!historyTarget) return null` from
 * `usePreviewHistory.ts:145` (WBS round-1 review).
 *
 * `currentContent` is forwarded from the artifact-panel and is only used
 * by the Save button (so a manual snapshot captures what's currently
 * being viewed, not stale disk content).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { History, RotateCcw, Save, GitCompareArrows, X, ListTree } from "lucide-react";
import { useFileHistory } from "./hooks/use-file-history";
import { DiffViewer } from "./viewers/diff-viewer";

type Props = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  filePath: string | null;
  /** Optional: pre-loaded file content for the "Save snapshot" form. */
  currentContent?: string;
  /** Optional: invoked when the user picks a file in the "All changes" tab. */
  onSelectFile?: (path: string) => void;
};

function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}

type CompareState =
  | { kind: "idle" }
  | { kind: "loading"; snapshotId: string }
  | { kind: "ready"; snapshotId: string; diff: string }
  | { kind: "error"; snapshotId: string; message: string };

export function FileHistoryPanel({ client, workspaceId, filePath, currentContent, onSelectFile }: Props) {
  const { history, historyLoading, historyError, saveManualSnapshot, isSaving, restoreSnapshot, isRestoring } =
    useFileHistory({ client, workspaceId, filePath });
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareState>({ kind: "idle" });

  const changesQuery = useQuery<{ items: Array<{ filePath: string; latestSnapshotAt: number; snapshotCount: number; latestTrigger: "auto" | "manual" }> }>({
    queryKey: ["workspace-changes", workspaceId],
    queryFn: async () => {
      if (!client || !workspaceId) return { items: [] };
      return client.listWorkspaceChanges(workspaceId, { limit: 100 });
    },
    enabled: Boolean(client && workspaceId),
    staleTime: 5_000,
  });

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
      if (compare.kind === "ready" && compare.snapshotId === snapshotId) {
        setCompare({ kind: "idle" });
      }
      void changesQuery.refetch();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : String(err));
    }
  };

  const onCompare = async (snapshotId: string) => {
    if (!client) return;
    setCompare({ kind: "loading", snapshotId });
    try {
      const result = await client.diffFileSnapshots(workspaceId, filePath, snapshotId, "current");
      setCompare({ kind: "ready", snapshotId, diff: result.diff });
    } catch (err) {
      setCompare({
        kind: "error",
        snapshotId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="flex w-[28rem] max-w-[90vw] flex-col gap-3 p-3" data-testid="file-history-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-dls-text">
          <History className="h-3.5 w-3.5" />
          <span>{filePath.split("/").pop()}</span>
        </div>
        <span className="text-[10px] text-dls-secondary">{history.length} snapshot{history.length === 1 ? "" : "s"}</span>
      </div>

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history" data-testid="file-history-tab-history">History</TabsTrigger>
          <TabsTrigger value="changes" data-testid="file-history-tab-changes">
            <ListTree className="mr-1 inline h-3 w-3" />
            All changes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="flex flex-col gap-3">
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
                              onClick={() => void onCompare(snap.id)}
                              disabled={compare.kind === "loading"}
                              aria-label="Compare with current"
                              data-testid="file-history-compare"
                            >
                              <GitCompareArrows />
                            </Button>
                          }
                        />
                        <TooltipContent>Compare with current</TooltipContent>
                      </Tooltip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {compare.kind === "loading" ? (
            <div className="text-[11px] text-dls-secondary" data-testid="file-history-diff-loading">
              Loading diff for {compare.snapshotId.slice(0, 12)}…
            </div>
          ) : null}
          {compare.kind === "error" ? (
            <div className="text-[11px] text-red-500" data-testid="file-history-diff-error">
              {compare.message}
            </div>
          ) : null}
          {compare.kind === "ready" ? (
            <div className="flex flex-col gap-2" data-testid="file-history-diff">
              <div className="flex items-center justify-between text-[10px] text-dls-secondary">
                <span>
                  Diff: {compare.snapshotId.slice(0, 12)}… vs current
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setCompare({ kind: "idle" })}
                  aria-label="Close diff"
                  data-testid="file-history-diff-close"
                >
                  <X />
                </Button>
              </div>
              {compare.diff ? (
                <DiffViewer diff={compare.diff} className="max-h-72 overflow-auto" />
              ) : (
                <div className="text-[11px] text-dls-secondary">No changes between this snapshot and the current file.</div>
              )}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="changes" className="flex flex-col gap-2">
          {changesQuery.isLoading ? (
            <div className="p-3 text-center text-[11px] text-dls-secondary">Loading…</div>
          ) : changesQuery.error ? (
            <div className="p-3 text-center text-[11px] text-red-500">
              {(changesQuery.error as Error).message}
            </div>
          ) : (changesQuery.data?.items.length ?? 0) === 0 ? (
            <div className="p-3 text-center text-[11px] text-dls-secondary">
              No changes tracked yet — edit a file to start.
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto rounded-md border border-dls-border" data-testid="file-history-changes-list">
              {changesQuery.data?.items.map((item) => (
                <li
                  key={item.filePath}
                  className="flex items-center justify-between gap-2 p-2 text-[11px] hover:bg-dls-sidebar/40"
                  data-testid="file-history-changes-row"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => onSelectFile?.(item.filePath)}
                    data-testid="file-history-changes-pick"
                  >
                    <div className="truncate font-mono text-[10px] text-dls-text">{item.filePath}</div>
                    <div className="text-[10px] text-dls-secondary">
                      {formatRelative(item.latestSnapshotAt)} · {item.snapshotCount} snapshot{item.snapshotCount === 1 ? "" : "s"} · {item.latestTrigger}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
