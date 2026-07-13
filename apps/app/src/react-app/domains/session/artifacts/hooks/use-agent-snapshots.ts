/** @jsxImportSource react */
/**
 * Phase 6.9: `useAgentSnapshots` — paginated agent-snapshot history.
 *
 * Wraps TanStack `useInfiniteQuery` against the
 * `GET /agent-snapshots?cursor=...&limit=...&status=...` endpoint
 * (cursor is `createdAt` DESC). Used by the History inner tab.
 */
import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";

import type {
  OpenworkFileSnapshot,
  OpenworkFileSnapshotStatus,
  OpenworkServerClient,
} from "@/app/lib/openwork-server";

export const AGENT_SNAPSHOTS_PAGE_SIZE = 50;

export type UseAgentSnapshotsInput = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  status?: OpenworkFileSnapshotStatus;
  pageSize?: number;
};

export type AgentSnapshotsPage = {
  items: OpenworkFileSnapshot[];
  nextCursor: number | null;
};

export function useAgentSnapshots({
  client,
  workspaceId,
  status,
  pageSize = AGENT_SNAPSHOTS_PAGE_SIZE,
}: UseAgentSnapshotsInput): UseInfiniteQueryResult<InfiniteData<AgentSnapshotsPage, number | null>, Error> {
  return useInfiniteQuery<
    AgentSnapshotsPage,
    Error,
    InfiniteData<AgentSnapshotsPage, number | null>,
    [string, string | null, OpenworkFileSnapshotStatus | undefined],
    number | null
  >({
    queryKey: ["agent-snapshots", workspaceId, status] as const,
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      if (!client || !workspaceId) {
        return { items: [], nextCursor: null };
      }
      const result = await client.listAgentSnapshots(workspaceId, {
        status,
        limit: pageSize,
        before: pageParam ?? undefined,
      });
      return { items: result.items, nextCursor: result.nextCursor };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(client && workspaceId),
    staleTime: 30_000,
  });
}
