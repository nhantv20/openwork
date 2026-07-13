/** @jsxImportSource react */
/**
 * Phase 6.9: Review Tab — main container.
 *
 * Three inner tabs:
 *   - Changes  : pending agent edits with Approve / Reject per file
 *   - History  : paginated timeline of every agent snapshot
 *   - Diff     : full diff viewer with file picker + ref selector
 *
 * This file owns the inner-tab switcher, the keyboard shortcut
 * `⌘⌥3` to surface the tab from the right panel header, and the
 * per-session error boundary.
 *
 * Inner-tab bodies live in sibling files (review-changes-tab.tsx,
 * review-history-tab.tsx, review-diff-tab.tsx) so this file stays
 * small.
 */
import * as React from "react";
import { GitCompare, History, ListChecks } from "lucide-react";

import { ErrorBoundary } from "@/components/error-boundary";
import { cn } from "@/lib/utils";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";

import {
  useActiveReviewInnerTab,
  useReviewStore,
  type ReviewInnerTab,
} from "./review-store";
import { ReviewChangesTab } from "./review-changes-tab";
import { ReviewHistoryTab } from "./review-history-tab";
import { ReviewDiffTab } from "./review-diff-tab";

type ReviewPanelProps = {
  sessionId: string;
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  workspaceRoot: string;
};

const INNER_TABS: ReadonlyArray<{
  id: ReviewInnerTab;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: "changes", label: "Changes", icon: ListChecks },
  { id: "history", label: "History", icon: History },
  { id: "diff", label: "Diff", icon: GitCompare },
];

export function ReviewPanel({
  sessionId,
  client,
  workspaceId,
}: ReviewPanelProps) {
  const activeTab = useActiveReviewInnerTab(sessionId);
  const setActiveTab = useReviewStore((s) => s.setActiveInnerTab);
  const markSeen = useReviewStore((s) => s.markSeen);

  // Mark the badge as seen the moment the user lands on the panel.
  React.useEffect(() => {
    markSeen(sessionId);
  }, [sessionId, markSeen]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Review inner tabs"
        className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-background px-2"
      >
        {INNER_TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`review-tab-panel-${id}`}
              id={`review-tab-${id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(sessionId, id)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs",
                active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ErrorBoundary
          title="Review panel failed to load"
          resetKey={`${sessionId}:${activeTab}`}
        >
          {activeTab === "changes" ? (
            <ReviewChangesTab
              sessionId={sessionId}
              client={client}
              workspaceId={workspaceId}
            />
          ) : activeTab === "history" ? (
            <ReviewHistoryTab
              sessionId={sessionId}
              client={client}
              workspaceId={workspaceId}
            />
          ) : (
            <ReviewDiffTab
              sessionId={sessionId}
              client={client}
              workspaceId={workspaceId}
            />
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
