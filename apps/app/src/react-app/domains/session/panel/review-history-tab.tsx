/** @jsxImportSource react */
/**
 * Phase 6.9: Review tab — History inner tab.
 *
 * Paginated timeline of every agent snapshot (pending / approved /
 * rejected / legacy). Uses `useInfiniteQuery` against
 * `GET /agent-snapshots` and exposes a "Load more" button instead of
 * infinite scroll (the plan review settled on a Load-more button
 * because the right panel is a narrow vertical surface where scroll
 * detection is awkward).
 */
import * as React from "react";
import { Check, History, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  OpenworkFileSnapshot,
  OpenworkServerClient,
} from "@/app/lib/openwork-server";

import { useAgentSnapshots } from "../artifacts/hooks/use-agent-snapshots";
import {
  useHistoryStatusFilter,
  useReviewStore,
  type ReviewHistoryFilter,
} from "./review-store";

type ReviewHistoryTabProps = {
  sessionId: string;
  client: OpenworkServerClient | null;
  workspaceId: string | null;
};

const FILTERS: ReadonlyArray<{ id: ReviewHistoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

export function ReviewHistoryTab({
  sessionId,
  client,
  workspaceId,
}: ReviewHistoryTabProps) {
  const filter = useHistoryStatusFilter(sessionId);
  const setFilter = useReviewStore((s) => s.setHistoryStatusFilter);
  const status = filter === "all" ? undefined : filter;

  const query = useAgentSnapshots({ client, workspaceId, status });

  const items = React.useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  return (
    <div
      role="tabpanel"
      id="review-tab-panel-history"
      aria-labelledby="review-tab-history"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2 text-xs">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            type="button"
            size="xs"
            variant={filter === f.id ? "default" : "ghost"}
            onClick={() => setFilter(sessionId, f.id)}
            aria-pressed={filter === f.id}
          >
            {f.label}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isError ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
            Failed to load: {query.error?.message}
          </div>
        ) : items.length === 0 && !query.isFetching ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <History className="size-6 opacity-40" />
            <p className="font-medium">No history yet</p>
            <p className="text-xs">Agent snapshots will appear here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((snap) => (
              <ReviewSnapshotItem key={snap.id} snapshot={snap} />
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-center border-t border-border p-2">
        {query.hasNextPage ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
            aria-label="Load more snapshots"
          >
            {query.isFetchingNextPage ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            Load more
          </Button>
        ) : items.length > 0 ? (
          <span className="text-[10px] text-muted-foreground">End of history</span>
        ) : null}
      </div>
    </div>
  );
}

function ReviewSnapshotItem({ snapshot }: { snapshot: OpenworkFileSnapshot }) {
  const status = snapshot.status ?? "legacy";
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-medium">
          <StatusBadge status={status} />
          <span className="truncate" title={snapshot.filePath}>
            {snapshot.filePath}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          {new Date(snapshot.createdAt).toLocaleString()} · {formatBytes(snapshot.size)} ·{" "}
          {snapshot.id.slice(0, 6)}
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: "pending" | "approved" | "rejected" | "legacy" }) {
  if (status === "approved") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700",
          "dark:bg-emerald-900/40 dark:text-emerald-300",
        )}
      >
        <Check className="size-2.5" /> Approved
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-700",
          "dark:bg-red-900/40 dark:text-red-300",
        )}
      >
        <X className="size-2.5" /> Rejected
      </span>
    );
  }
  if (status === "legacy") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-700",
          "dark:bg-zinc-800 dark:text-zinc-300",
        )}
      >
        Legacy
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700",
        "dark:bg-amber-900/40 dark:text-amber-300",
      )}
    >
      <Loader2 className="size-2.5" /> Pending
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
