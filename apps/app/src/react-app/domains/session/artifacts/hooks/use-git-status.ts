/** @jsxImportSource react */
/**
 * Phase 6.6 — `useGitStatus` hook.
 *
 * Wraps the `/git/status` endpoint in a single React Query call so
 * `ArtifactPanel` and `GitReviewTab` (or any future consumer) share one
 * cache entry per (workspace, file) pair instead of running the same
 * query twice. TanStack dedupe would also prevent duplicate network
 * calls, but sharing the data through a single hook makes the data
 * flow obvious in the React tree.
 */
import { useQuery } from "@tanstack/react-query";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";

export type GitStatus = {
  isGitRepo: boolean;
  currentBranch: string | null;
  isTracked: boolean;
  isStaged: boolean;
  isModified: boolean;
  hasUncommittedChanges: boolean;
};

type UseGitStatusInput = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  filePath: string | null;
  enabled?: boolean;
};

export function useGitStatus({ client, workspaceId, filePath, enabled = true }: UseGitStatusInput) {
  return useQuery<GitStatus | null>({
    queryKey: ["git-status", workspaceId, filePath] as const,
    queryFn: async () => {
      if (!client || !workspaceId || !filePath) return null;
      return client.getGitStatus(workspaceId, filePath);
    },
    enabled: enabled && Boolean(client && workspaceId && filePath),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
