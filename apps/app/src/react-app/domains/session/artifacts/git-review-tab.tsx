/** @jsxImportSource react */
/**
 * Phase 6.6 — Git review tab.
 *
 * Renders inside the artifact panel body when the user clicks the
 * "Review" tab. Shows the file's current state vs a git ref (HEAD,
 * staged, working tree) using the same `DiffViewer` that the History
 * popover uses for snapshot-vs-snapshot diffs.
 *
 * Read-only MVP: there are no "init repo" / "stage file" / "commit"
 * buttons — the user can still run `git` from the terminal tab if they
 * want to mutate the repo. This tab is purely for review.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { DiffViewer } from "./viewers/diff-viewer";
import { useGitStatus } from "./hooks/use-git-status";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  client: OpenworkServerClient;
  workspaceId: string;
  filePath: string;
};

const SYMBOLIC_OPTIONS: Array<{ value: "HEAD" | "STAGED" | "WORKING"; label: string }> = [
  { value: "HEAD", label: "HEAD" },
  { value: "STAGED", label: "Staged" },
  { value: "WORKING", label: "Working tree" },
];

export function GitReviewTab({ client, workspaceId, filePath }: Props) {
  const [fromRef, setFromRef] = useState<"HEAD" | "STAGED" | "WORKING">("HEAD");
  const [toRef, setToRef] = useState<"HEAD" | "STAGED" | "WORKING">("WORKING");

  // Reuse the same query ArtifactPanel already fetched — TanStack
  // returns the cached entry synchronously, so the badge below renders
  // without a second network call.
  const statusQuery = useGitStatus({ client, workspaceId, filePath });

  const diffQuery = useQuery({
    queryKey: ["git-diff", workspaceId, filePath, fromRef, toRef] as const,
    queryFn: () => client.getGitDiff(workspaceId, { path: filePath, from: fromRef, to: toRef }),
    enabled: fromRef !== toRef,
    // 2s is short enough to feel live but long enough to dedupe rapid
    // dropdown toggles and avoid hammering the server.
    staleTime: 2_000,
  });

  // Trivial case: same ref on both sides → no diff possible.
  if (fromRef === toRef) {
    return (
      <div className="flex h-full flex-col gap-3 p-4 text-xs" data-testid="git-review-tab">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">From</span>
          <RefPicker value={fromRef} onChange={setFromRef} />
          <span className="text-muted-foreground">To</span>
          <RefPicker value={toRef} onChange={setToRef} />
        </div>
        <div className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">
          Pick two different refs to see a diff.
        </div>
      </div>
    );
  }

  const status = statusQuery.data;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 text-xs" data-testid="git-review-tab">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">From</span>
        <RefPicker value={fromRef} onChange={setFromRef} />
        <span className="text-muted-foreground">To</span>
        <RefPicker value={toRef} onChange={setToRef} />
        {status?.currentBranch ? (
          <span className="ml-2 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground" data-testid="git-review-branch">
            {status.currentBranch}
          </span>
        ) : null}
        {status?.isTracked ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground" data-testid="git-review-tracked">
            tracked
          </span>
        ) : null}
        {status?.hasUncommittedChanges ? (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300" data-testid="git-review-dirty">
            uncommitted
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        {diffQuery.isLoading ? (
          <div className="p-4 text-center text-muted-foreground">Loading diff…</div>
        ) : diffQuery.error ? (
          <div className="p-4 text-center text-red-500">
            {diffQuery.error instanceof Error ? diffQuery.error.message : "Failed to load diff"}
          </div>
        ) : diffQuery.data?.isBinary ? (
          <EmptyState message="Binary file — diff not shown." />
        ) : diffQuery.data?.fileUntracked && !diffQuery.data?.diff ? (
          // Server only synthesizes a diff when the working tree has
          // content. An empty untracked file legitimately has no diff.
          <EmptyState message="File is not tracked by git (and is empty)." />
        ) : !diffQuery.data?.diff ? (
          <EmptyState message={emptyDiffMessage(fromRef, toRef)} />
        ) : (
          <>
            {diffQuery.data.fileUntracked ? (
              <div className="border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground" data-testid="git-review-untracked-banner">
                New file — not yet tracked by git.
              </div>
            ) : null}
            {diffQuery.data.truncated ? (
              <div className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                Diff truncated — file too large to display in full.
              </div>
            ) : null}
            <DiffViewer diff={diffQuery.data.diff} className="p-3" />
          </>
        )}
      </div>
    </div>
  );
}

function RefPicker({
  value,
  onChange,
}: {
  value: "HEAD" | "STAGED" | "WORKING";
  onChange: (next: "HEAD" | "STAGED" | "WORKING") => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as typeof value)}>
      <SelectTrigger className="h-7 w-[120px] text-xs" data-testid="git-review-ref-picker">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SYMBOLIC_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="p-6 text-center text-muted-foreground" data-testid="git-review-empty">
      {message}
    </div>
  );
}

function emptyDiffMessage(from: string, to: string): string {
  if (from === "HEAD" && to === "WORKING") return "Working tree matches HEAD.";
  if (from === "HEAD" && to === "STAGED") return "No staged changes.";
  if (from === "STAGED" && to === "WORKING") return "Working tree matches index.";
  return "No changes between the selected refs.";
}
