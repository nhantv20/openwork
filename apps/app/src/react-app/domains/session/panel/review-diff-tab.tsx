/** @jsxImportSource react */
/**
 * Phase 6.9: Review tab — Diff inner tab.
 *
 * File picker + ref selector + full diff viewer. Defaults to the
 * first pending file. Re-uses the existing `useFileDiff` hook so
 * the cache is shared with the inline diff in `ReviewChangesTab`.
 *
 * Performance:
 *   - Diff content lazy-loaded on first render of this tab.
 *   - Large files (> 1MB) get a soft warning chip.
 *   - Diff content > 5000 lines is truncated with a "view full"
 *     banner. (We use a window.alert placeholder here for the full
 *     view; M10 can wire a proper modal if needed.)
 */
import * as React from "react";
import { GitCompare, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";

import { useFileDiff } from "../artifacts/hooks/use-file-diff";
import { usePendingApprovals } from "../artifacts/hooks/use-pending-approvals";
import { DiffViewer } from "../artifacts/viewers/diff-viewer";
import { useActiveDiffFile, useReviewStore } from "./review-store";

const LARGE_FILE_BYTES = 1_000_000;
const MAX_DIFF_LINES = 5_000;

type ReviewDiffTabProps = {
  sessionId: string;
  client: OpenworkServerClient | null;
  workspaceId: string | null;
};

export function ReviewDiffTab({
  sessionId,
  client,
  workspaceId,
}: ReviewDiffTabProps) {
  const pending = usePendingApprovals({ client, workspaceId, sessionId });
  const activeFile = useActiveDiffFile(sessionId);
  const setActiveFile = useReviewStore((s) => s.setActiveDiffFile);

  const items = pending.data ?? [];

  // Default to the first pending file when the user hasn't picked one
  // yet (or the previous pick is no longer in the list).
  React.useEffect(() => {
    if (items.length === 0) {
      if (activeFile !== null) setActiveFile(sessionId, null);
      return;
    }
    const stillThere = activeFile && items.some((i) => i.filePath === activeFile);
    if (!stillThere) {
      setActiveFile(sessionId, items[0].filePath);
    }
  }, [items, activeFile, sessionId, setActiveFile]);

  const selected = items.find((i) => i.filePath === activeFile) ?? null;

  return (
    <div
      role="tabpanel"
      id="review-tab-panel-diff"
      aria-labelledby="review-tab-diff"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2 text-xs">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <span>File</span>
          <select
            className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
            value={activeFile ?? ""}
            onChange={(e) => setActiveFile(sessionId, e.target.value || null)}
            aria-label="Choose file to diff"
          >
            {items.length === 0 ? <option value="">No pending files</option> : null}
            {items.map((i) => (
              <option key={i.snapshotId} value={i.filePath}>
                {i.filePath}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[10px] text-muted-foreground">Pre-AI → Current</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {!selected ? (
          <EmptyState />
        ) : selected.size != null && selected.size > LARGE_FILE_BYTES ? (
          <LargeFileWarning
            bytes={selected.size}
            filePath={selected.filePath}
          >
            <DiffBody
              client={client}
              workspaceId={workspaceId}
              filePath={selected.filePath}
              parentSnapshotId={selected.parentSnapshotId}
            />
          </LargeFileWarning>
        ) : (
          <DiffBody
            client={client}
            workspaceId={workspaceId}
            filePath={selected.filePath}
            parentSnapshotId={selected.parentSnapshotId}
          />
        )}
      </div>
    </div>
  );
}

function DiffBody({
  client,
  workspaceId,
  filePath,
  parentSnapshotId,
}: {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  filePath: string;
  parentSnapshotId: string | null;
}) {
  const query = useFileDiff({
    client,
    workspaceId,
    filePath,
    parentSnapshotId,
  });

  if (!parentSnapshotId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        <p>Initial version — no pre-AI snapshot to diff against.</p>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading diff…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
        Failed to load diff: {query.error?.message ?? "unknown"}
      </div>
    );
  }

  const diff = query.data?.diff ?? "";
  const totalLines = diff ? diff.split("\n").length : 0;
  const truncated = totalLines > MAX_DIFF_LINES;
  const visibleDiff = truncated
    ? diff.split("\n").slice(0, MAX_DIFF_LINES).join("\n")
    : diff;

  if (diff.trim().length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        <p>No changes to display.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {truncated ? (
        <div className="border-b border-border bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          Diff truncated — showing first {MAX_DIFF_LINES.toLocaleString()} of {totalLines.toLocaleString()} lines.
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <DiffViewer diff={visibleDiff} language={filePath.split(".").pop()} />
      </div>
    </div>
  );
}

function LargeFileWarning({
  bytes,
  filePath,
  children,
}: {
  bytes: number;
  filePath: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
        Large file ({formatBytes(bytes)}): <code>{filePath}</code>. Diff may be slow to render.
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground")}>
      <GitCompare className="size-6 opacity-40" />
      <p className="font-medium">No file selected</p>
      <p className="text-xs">Approve / reject a file from the Changes tab first.</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
