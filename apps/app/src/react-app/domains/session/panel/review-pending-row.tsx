/** @jsxImportSource react */
/**
 * Phase 6.9: Single pending-file row in the Review tab.
 *
 * Owns:
 * - the row chrome (path, timestamp, action buttons)
 * - the per-row mutation lock (disabled state when an Approve/Reject
 *   for THIS snapshot id is in flight — the plan review flagged the
 *   global `isPending` as a race-condition risk)
 * - the inline diff, fetched lazily on expand via `useFileDiff` and
 *   rendered with the shared DiffViewer
 * - a soft warning when the underlying file is large (> 1MB)
 */
import * as React from "react";
import { Check, FileCode, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";

import { useFileDiff } from "../artifacts/hooks/use-file-diff";
import { DiffViewer } from "../artifacts/viewers/diff-viewer";
import { useReviewStore } from "./review-store";
import type { useApprovalMutations } from "../artifacts/hooks/use-pending-approvals";

const LARGE_FILE_BYTES = 1_000_000;
const MAX_INLINE_DIFF_LINES = 5_000;

type Mutations = ReturnType<typeof useApprovalMutations>;

export type ReviewPendingRowProps = {
  item: {
    filePath: string;
    snapshotId: string;
    parentSnapshotId: string | null;
    createdAt: number;
    addedLines?: number;
    removedLines?: number;
    size?: number;
  };
  sessionId: string;
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  mutations: Mutations;
};

export function ReviewPendingRow({
  item,
  sessionId,
  client,
  workspaceId,
  mutations,
}: ReviewPendingRowProps) {
  const isMutating = useReviewStore((s) =>
    s.pendingMutationIds.has(item.snapshotId),
  );
  const isExpanded = useReviewStore((s) =>
    (s.expandedFilesBySession[sessionId] ?? []).includes(item.filePath),
  );
  const toggleExpanded = useReviewStore((s) => s.toggleExpanded);

  return (
    <li className="px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-medium">
            <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate" title={item.filePath}>
              {item.filePath}
            </span>
            {(item.addedLines != null && item.addedLines > 0) ||
            (item.removedLines != null && item.removedLines > 0) ? (
              <span className="ml-1 font-mono text-[10px] tabular-nums">
                {item.addedLines != null && item.addedLines > 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    +{item.addedLines}
                  </span>
                ) : null}
                {item.addedLines != null &&
                item.addedLines > 0 &&
                item.removedLines != null &&
                item.removedLines > 0
                  ? " "
                  : null}
                {item.removedLines != null && item.removedLines > 0 ? (
                  <span className="text-red-600 dark:text-red-400">
                    -{item.removedLines}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>AI edit · {formatRelative(item.createdAt)}</span>
            {item.size != null && item.size > LARGE_FILE_BYTES ? (
              <span className="text-amber-600 dark:text-amber-400">
                Large file (~{formatBytes(item.size)})
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => toggleExpanded(sessionId, item.filePath)}
            aria-label={isExpanded ? "Hide diff" : "View diff"}
            aria-expanded={isExpanded}
          >
            {isExpanded ? "Hide" : "View diff"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="default"
            disabled={isMutating}
            onClick={() => mutations.approve.mutate({ snapshotId: item.snapshotId })}
            aria-label={`Approve ${item.filePath}`}
          >
            {isMutating ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Approve
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={isMutating || item.parentSnapshotId == null}
            onClick={() => mutations.reject.mutate({ snapshotId: item.snapshotId })}
            aria-label={`Reject ${item.filePath}`}
            title={
              item.parentSnapshotId == null
                ? "No pre-AI snapshot; cannot reject"
                : undefined
            }
          >
            {isMutating ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
            Reject
          </Button>
        </div>
      </div>
      {isExpanded ? (
        <InlineDiff
          sessionId={sessionId}
          client={client}
          workspaceId={workspaceId}
          filePath={item.filePath}
          parentSnapshotId={item.parentSnapshotId}
        />
      ) : null}
    </li>
  );
}

function InlineDiff({
  sessionId: _sessionId,
  client,
  workspaceId,
  filePath,
  parentSnapshotId,
}: {
  sessionId: string;
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
      <div
        className={cn(
          "mt-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground",
        )}
      >
        Initial version — no pre-AI snapshot to diff against.
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Loading diff…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mt-2 text-[11px] text-destructive">
        Failed to load diff: {query.error?.message ?? "unknown"}
      </div>
    );
  }

  const diff = query.data?.diff ?? "";
  const truncated = countLines(diff) > MAX_INLINE_DIFF_LINES;
  const visibleDiff = truncated
    ? diff.split("\n").slice(0, MAX_INLINE_DIFF_LINES).join("\n")
    : diff;

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border">
      {truncated ? (
        <div className="border-b border-border bg-amber-50 px-2 py-1 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          Diff truncated — showing first {MAX_INLINE_DIFF_LINES.toLocaleString()} lines.{" "}
          <ViewFullButton sessionId={_sessionId} filePath={filePath} />
        </div>
      ) : null}
      <DiffViewer diff={visibleDiff} className="max-h-80 overflow-auto" />
    </div>
  );
}

/**
 * L6 fix: clicking "View full" switches the user over to the Diff
 * inner tab and pre-fills the file picker, instead of popping an
 * `alert(...)` placeholder. The Diff tab uses the same
 * `activeDiffFileBySession` slot in the store, so this is just two
 * store writes.
 */
function ViewFullButton({
  sessionId,
  filePath,
}: {
  sessionId: string;
  filePath: string;
}) {
  const setActiveInnerTab = useReviewStore((s) => s.setActiveInnerTab);
  const setActiveDiffFile = useReviewStore((s) => s.setActiveDiffFile);
  return (
    <button
      type="button"
      className="underline"
      onClick={() => {
        setActiveDiffFile(sessionId, filePath);
        setActiveInnerTab(sessionId, "diff");
      }}
    >
      View full
    </button>
  );
}

function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}
