/** @jsxImportSource react */
/**
 * Phase 6.9: Review tab — Changes inner tab.
 *
 * Renders the list of files waiting for approval. Each row is its
 * own component (`review-pending-row.tsx`) so a single row can have
 * an in-flight mutation without blocking the rest of the list.
 */
import * as React from "react";
import { Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";

import {
  useApprovalMutations,
  usePendingApprovals,
} from "../artifacts/hooks/use-pending-approvals";
import { ReviewPendingRow } from "./review-pending-row";

type ReviewChangesTabProps = {
  sessionId: string;
  client: OpenworkServerClient | null;
  workspaceId: string | null;
};

export function ReviewChangesTab({
  sessionId,
  client,
  workspaceId,
}: ReviewChangesTabProps) {
  const query = usePendingApprovals({ client, workspaceId, sessionId });
  const mutations = useApprovalMutations({ client, workspaceId, sessionId });

  const items = query.data ?? [];
  const isFetching = query.isFetching;

  // Aggregate +X -Y across every pending row so the header summary
  // matches the "Edited N files +A -B" preview the user expects
  // (mirrors the pattern used in chat tool summaries).
  const totals = React.useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const item of items) {
      added += item.addedLines ?? 0;
      removed += item.removedLines ?? 0;
    }
    return { added, removed };
  }, [items]);

  return (
    <div
      role="tabpanel"
      id="review-tab-panel-changes"
      aria-labelledby="review-tab-changes"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span>
            {items.length} pending
            {isFetching ? <Loader2 className="ml-1 inline size-3 animate-spin" /> : null}
          </span>
          {items.length > 0 ? (
            <span className="font-mono text-[10px] tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">+{totals.added}</span>{" "}
              <span className="text-red-600 dark:text-red-400">-{totals.removed}</span>
            </span>
          ) : null}
        </span>
        <BulkActions
          items={items}
          mutations={mutations}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isError ? (
          <ErrorState message={query.error?.message ?? "Failed to load"} />
        ) : items.length === 0 && !isFetching ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-border" role="list">
            {items.map((item) => (
              <ReviewPendingRow
                key={item.snapshotId}
                item={item}
                sessionId={sessionId}
                client={client}
                workspaceId={workspaceId}
                mutations={mutations}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type Mutations = ReturnType<typeof useApprovalMutations>;

function BulkActions({
  items,
  mutations,
}: {
  items: ReadonlyArray<{ snapshotId: string }>;
  mutations: Mutations;
}) {
  // L2 fix: the parent `ReviewChangesTab` already owns the polling
  // hook. We accept the rendered items as a prop instead of calling
  // the hook again here — otherwise we'd register two visibility
  // listeners and run the `useEffect → setPendingCount` pipeline
  // twice per render.
  const ids = React.useMemo(() => items.map((i) => i.snapshotId), [items]);
  const disabled = ids.length === 0;
  // Cross-disable the other bulk button while one is in flight so the
  // user can't fire Approve all + Reject all in parallel and create a
  // mixed state that's hard to reason about.
  const anyBulkInFlight = mutations.approveAll.isPending || mutations.rejectAll.isPending;
  const approveFailed = mutations.approveAll.data?.failed ?? [];
  const rejectFailed = mutations.rejectAll.data?.failed ?? [];

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={disabled || anyBulkInFlight}
          onClick={() => mutations.approveAll.mutate({ snapshotIds: ids })}
          aria-label="Approve all pending files"
        >
          {mutations.approveAll.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Check className="size-3" />
          )}
          Approve all
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={disabled || anyBulkInFlight}
          onClick={() => mutations.rejectAll.mutate({ snapshotIds: ids })}
          aria-label="Reject all pending files"
        >
          {mutations.rejectAll.isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <X className="size-3" />
          )}
          Reject all
        </Button>
      </div>
      {approveFailed.length > 0 || rejectFailed.length > 0 ? (
        <div className="text-[10px] text-amber-600 dark:text-amber-400">
          {approveFailed.length > 0
            ? `${mutations.approveAll.data?.approvedCount ?? 0} approved, ${approveFailed.length} failed`
            : null}
          {rejectFailed.length > 0
            ? `${mutations.rejectAll.data?.rejectedCount ?? 0} rejected, ${rejectFailed.length} failed`
            : null}
        </div>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      <Check className="size-6 opacity-40" />
      <p className="font-medium">No pending changes</p>
      <p className="text-xs">Agent edits will appear here for review.</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-destructive")}>
      <p className="font-medium">Failed to load pending changes</p>
      <p className="text-xs">{message}</p>
    </div>
  );
}
