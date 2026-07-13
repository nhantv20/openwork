/** @jsxImportSource react */
/**
 * Phase 6.9: `usePendingApprovals` — fetch + poll + mutate.
 *
 * The `useQuery` polls every 10s and pauses when `document.hidden`
 * (rev 2 perf fix from the plan review). The pause is implemented via
 * TanStack Query's `refetchInterval` callback (rev 3 fix — the earlier
 * `setState` hack did not actually pause anything because the prop
 * was a static constant).
 */
import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type {
  OpenworkBulkApprovalResult,
  OpenworkPendingApproval,
  OpenworkServerClient,
} from "@/app/lib/openwork-server";

import { useReviewStore } from "../../panel/review-store";

export const PENDING_APPROVALS_POLL_MS = 10_000;

export type UsePendingApprovalsInput = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  sessionId: string;
  /** Override poll interval (mainly for tests). */
  refetchIntervalMs?: number;
};

export function usePendingApprovals({
  client,
  workspaceId,
  sessionId,
  refetchIntervalMs = PENDING_APPROVALS_POLL_MS,
}: UsePendingApprovalsInput): UseQueryResult<OpenworkPendingApproval[]> {
  const setPendingCount = useReviewStore((s) => s.setPendingCount);

  // Track document visibility. `refetchInterval` becomes a callback
  // below so the query is actually gated on the current value.
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => setIsVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  const query = useQuery<OpenworkPendingApproval[]>({
    queryKey: ["pending-approvals", workspaceId] as const,
    queryFn: async () => {
      if (!client || !workspaceId) return [];
      const result = await client.listPendingApprovals(workspaceId);
      return result.items;
    },
    enabled: Boolean(client && workspaceId) && isVisible,
    // Callback form returns `false` to skip this tick. We always
    // return the configured interval when visible; when hidden we
    // pause entirely. Re-evaluating per call lets the visibility
    // toggle take effect without re-mounting the query.
    refetchInterval: () => (isVisible ? refetchIntervalMs : false),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  // Push the count into the Zustand store so the badge can render it
  // without subscribing to the whole list. Skip if no data.
  useEffect(() => {
    if (!query.data) return;
    const latestAt = query.data.reduce(
      (max, item) => (item.createdAt > max ? item.createdAt : max),
      0,
    );
    setPendingCount(sessionId, query.data.length, latestAt);
  }, [query.data, sessionId, setPendingCount]);

  return query;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type UseApprovalMutationsInput = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  sessionId: string;
};

export type ApprovalMutationResult = UseMutationResult<
  void,
  Error,
  { snapshotId: string }
>;

export function useApprovalMutations({
  client,
  workspaceId,
  sessionId,
}: UseApprovalMutationsInput) {
  const queryClient = useQueryClient();
  const pendingQueryKey = ["pending-approvals", workspaceId] as const;
  const addPending = useReviewStore((s) => s.addPendingMutation);
  const removePending = useReviewStore((s) => s.removePendingMutation);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: pendingQueryKey });
    await queryClient.invalidateQueries({ queryKey: ["agent-snapshots", workspaceId] });
  };

  const approve = useMutation<void, Error, { snapshotId: string }>({
    mutationFn: async ({ snapshotId }) => {
      if (!client || !workspaceId) throw new Error("client_not_ready");
      addPending(snapshotId);
      try {
        await client.approveSnapshot(workspaceId, snapshotId);
      } finally {
        removePending(snapshotId);
      }
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  const reject = useMutation<void, Error, { snapshotId: string }>({
    mutationFn: async ({ snapshotId }) => {
      if (!client || !workspaceId) throw new Error("client_not_ready");
      addPending(snapshotId);
      try {
        await client.rejectSnapshot(workspaceId, snapshotId);
      } finally {
        removePending(snapshotId);
      }
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  const approveAll = useMutation<OpenworkBulkApprovalResult, Error, { snapshotIds: string[] }>({
    mutationFn: async ({ snapshotIds }) => {
      if (!client || !workspaceId) throw new Error("client_not_ready");
      for (const id of snapshotIds) addPending(id);
      try {
        return await client.bulkApproveSnapshots(workspaceId, snapshotIds);
      } finally {
        for (const id of snapshotIds) removePending(id);
      }
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  const rejectAll = useMutation<OpenworkBulkApprovalResult, Error, { snapshotIds: string[] }>({
    mutationFn: async ({ snapshotIds }) => {
      if (!client || !workspaceId) throw new Error("client_not_ready");
      for (const id of snapshotIds) addPending(id);
      try {
        return await client.bulkRejectSnapshots(workspaceId, snapshotIds);
      } finally {
        for (const id of snapshotIds) removePending(id);
      }
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  return { approve, reject, approveAll, rejectAll, sessionId };
}
