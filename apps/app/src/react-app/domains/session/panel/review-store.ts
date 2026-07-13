/** @jsxImportSource react */
/**
 * Phase 6.9: Review Tab — Zustand store.
 *
 * Holds transient UI state for the right-panel Review tab:
 * - Pending count per session (drives the badge on the tab button)
 * - Active inner tab (Changes / History / Diff) per session
 * - Currently expanded file rows per session
 * - Per-file mutation tracking for the "disable Approve while pending" UX
 * - History tab status filter
 *
 * Server state (the actual list of pending files, the diff content, the
 * paginated history) lives in TanStack Query hooks, NOT here. Anything
 * cached in this store is small + cheap + not authoritative.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export type ReviewInnerTab = "changes" | "history" | "diff";
export type ReviewHistoryFilter = "all" | "pending" | "approved" | "rejected";

type SessionPending = {
  fileCount: number;
  latestAt: number;
  /** Has the user opened the Review tab since the most recent `latestAt`? */
  seen: boolean;
};

export type ReviewStoreState = {
  pendingBySession: Record<string, SessionPending>;
  activeInnerTabBySession: Record<string, ReviewInnerTab>;
  expandedFilesBySession: Record<string, string[]>;
  /**
   * Snapshot ids currently inside a running Approve/Reject mutation.
   * Stored as a Set (L1 fix from the rev-3 review) so the per-row
   * selector can do O(1) membership checks without re-running on
   * every other row's mutation lifecycle.
   */
  pendingMutationIds: Set<string>;
  historyStatusFilterBySession: Record<string, ReviewHistoryFilter>;
  activeDiffFileBySession: Record<string, string | null>;
};

export type ReviewStoreActions = {
  setPendingCount: (sessionId: string, count: number, latestAt: number) => void;
  markSeen: (sessionId: string) => void;
  setActiveInnerTab: (sessionId: string, tab: ReviewInnerTab) => void;
  toggleExpanded: (sessionId: string, filePath: string) => void;
  addPendingMutation: (snapshotId: string) => void;
  removePendingMutation: (snapshotId: string) => void;
  setHistoryStatusFilter: (sessionId: string, filter: ReviewHistoryFilter) => void;
  setActiveDiffFile: (sessionId: string, filePath: string | null) => void;
  clearSession: (sessionId: string) => void;
};

export type ReviewStore = ReviewStoreState & ReviewStoreActions;

const EMPTY_PENDING: SessionPending = { fileCount: 0, latestAt: 0, seen: true };

export const useReviewStore = create<ReviewStore>()((set) => ({
  pendingBySession: {},
  activeInnerTabBySession: {},
  expandedFilesBySession: {},
  pendingMutationIds: new Set<string>(),
  historyStatusFilterBySession: {},
  activeDiffFileBySession: {},

  setPendingCount: (sessionId, count, latestAt) =>
    set((state) => {
      const current = state.pendingBySession[sessionId] ?? EMPTY_PENDING;
      // New pending arrivals after the user has already seen the tab
      // mark the badge as unseen again so the pulse animation fires.
      const seen =
        current.seen && current.latestAt >= latestAt ? current.seen : false;
      if (current.fileCount === count && current.latestAt === latestAt && current.seen === seen) {
        return state;
      }
      return {
        pendingBySession: {
          ...state.pendingBySession,
          [sessionId]: { fileCount: count, latestAt, seen },
        },
      };
    }),

  markSeen: (sessionId) =>
    set((state) => {
      const current = state.pendingBySession[sessionId];
      if (!current || current.seen) return state;
      return {
        pendingBySession: {
          ...state.pendingBySession,
          [sessionId]: { ...current, seen: true },
        },
      };
    }),

  setActiveInnerTab: (sessionId, tab) =>
    set((state) => {
      if (state.activeInnerTabBySession[sessionId] === tab) return state;
      return {
        activeInnerTabBySession: {
          ...state.activeInnerTabBySession,
          [sessionId]: tab,
        },
      };
    }),

  toggleExpanded: (sessionId, filePath) =>
    set((state) => {
      const current = state.expandedFilesBySession[sessionId] ?? [];
      const next = current.includes(filePath)
        ? current.filter((p) => p !== filePath)
        : [...current, filePath];
      return {
        expandedFilesBySession: {
          ...state.expandedFilesBySession,
          [sessionId]: next,
        },
      };
    }),

  addPendingMutation: (snapshotId) =>
    set((state) => {
      if (state.pendingMutationIds.has(snapshotId)) return state;
      // Allocate a new Set so React sees a reference change and
      // selector consumers re-evaluate. Reuse the existing Set
      // instance to keep `add` cheap for the common case (the row
      // that was already added by an optimistic update).
      const next = new Set(state.pendingMutationIds);
      next.add(snapshotId);
      return { pendingMutationIds: next };
    }),

  removePendingMutation: (snapshotId) =>
    set((state) => {
      if (!state.pendingMutationIds.has(snapshotId)) return state;
      const next = new Set(state.pendingMutationIds);
      next.delete(snapshotId);
      return { pendingMutationIds: next };
    }),

  setHistoryStatusFilter: (sessionId, filter) =>
    set((state) => {
      if (state.historyStatusFilterBySession[sessionId] === filter) return state;
      return {
        historyStatusFilterBySession: {
          ...state.historyStatusFilterBySession,
          [sessionId]: filter,
        },
      };
    }),

  setActiveDiffFile: (sessionId, filePath) =>
    set((state) => {
      if (state.activeDiffFileBySession[sessionId] === filePath) return state;
      return {
        activeDiffFileBySession: {
          ...state.activeDiffFileBySession,
          [sessionId]: filePath,
        },
      };
    }),

  clearSession: (sessionId) =>
    set((state) => {
      let changed = false;
      const next: Partial<ReviewStoreState> = {};
      if (state.pendingBySession[sessionId]) {
        next.pendingBySession = { ...state.pendingBySession };
        delete (next.pendingBySession as Record<string, SessionPending>)[sessionId];
        changed = true;
      }
      if (state.activeInnerTabBySession[sessionId]) {
        next.activeInnerTabBySession = { ...state.activeInnerTabBySession };
        delete next.activeInnerTabBySession[sessionId];
        changed = true;
      }
      if (state.expandedFilesBySession[sessionId]) {
        next.expandedFilesBySession = { ...state.expandedFilesBySession };
        delete next.expandedFilesBySession[sessionId];
        changed = true;
      }
      if (state.historyStatusFilterBySession[sessionId]) {
        next.historyStatusFilterBySession = { ...state.historyStatusFilterBySession };
        delete next.historyStatusFilterBySession[sessionId];
        changed = true;
      }
      if (state.activeDiffFileBySession[sessionId]) {
        next.activeDiffFileBySession = { ...state.activeDiffFileBySession };
        delete next.activeDiffFileBySession[sessionId];
        changed = true;
      }
      if (state.pendingMutationIds.size > 0) {
        next.pendingMutationIds = new Set<string>();
        changed = true;
      }
      return changed ? (next as ReviewStore) : state;
    }),
}));

// ---------------------------------------------------------------------------
// Selector helpers — keep components out of the Zustand internals.
// ---------------------------------------------------------------------------
//
// L1 fix: every consumer of `pendingMutationIds` now uses a `useShallow`
// selector that returns only the `has(snapshotId)` boolean. That way a
// mutation on a different row does NOT cause a re-render of every row
// — each row only re-renders when its own id enters/leaves the Set.

export function useSessionPending(sessionId: string | null | undefined): SessionPending {
  return useReviewStore((state) =>
    sessionId ? state.pendingBySession[sessionId] ?? EMPTY_PENDING : EMPTY_PENDING,
  );
}

export function useActiveReviewInnerTab(
  sessionId: string | null | undefined,
): ReviewInnerTab {
  return useReviewStore((state) =>
    sessionId ? state.activeInnerTabBySession[sessionId] ?? "changes" : "changes",
  );
}

export function useIsMutationPending(snapshotId: string): boolean {
  return useReviewStore((state) => state.pendingMutationIds.has(snapshotId));
}

export function useExpandedFiles(
  sessionId: string | null | undefined,
): ReadonlySet<string> {
  // useShallow is unnecessary here: the array reference only changes
  // when the user toggles a file in this session, and a new Set is
  // rebuilt for stable identity.
  return useReviewStore((state) => {
    if (!sessionId) return EMPTY_SET;
    return new Set(state.expandedFilesBySession[sessionId] ?? EMPTY_ARRAY);
  });
}

export function useHistoryStatusFilter(
  sessionId: string | null | undefined,
): ReviewHistoryFilter {
  return useReviewStore((state) =>
    sessionId ? state.historyStatusFilterBySession[sessionId] ?? "all" : "all",
  );
}

export function useActiveDiffFile(sessionId: string | null | undefined): string | null {
  return useReviewStore((state) =>
    sessionId ? state.activeDiffFileBySession[sessionId] ?? null : null,
  );
}

/**
 * Bulk-set membership helper — returns the subset of `ids` that are
 * currently inside a running mutation. Used by bulk action buttons to
 * dim disabled rows in one shot. Returns a stable Set when nothing
 * is in flight so consumers can rely on reference equality.
 */
export function usePendingMutationIds(): ReadonlySet<string> {
  return useReviewStore(useShallow((state) => state.pendingMutationIds));
}

const EMPTY_ARRAY: string[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();
