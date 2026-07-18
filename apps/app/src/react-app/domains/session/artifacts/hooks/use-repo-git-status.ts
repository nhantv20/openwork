/** @jsxImportSource react */
import { useQuery } from "@tanstack/react-query";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";

export type RepoGitStatus = {
  isGitRepo: boolean;
  branch: string | null;
  staged: string[];
  modified: string[];
  untracked: string[];
};

type Input = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  enabled?: boolean;
};

export function useRepoGitStatus({ client, workspaceId, enabled = true }: Input) {
  return useQuery<RepoGitStatus>({
    queryKey: ["repo-git-status", workspaceId] as const,
    queryFn: async () => {
      if (!client || !workspaceId) return EMPTY;
      return client.getRepoGitStatus(workspaceId);
    },
    enabled: enabled && Boolean(client && workspaceId),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

const EMPTY: RepoGitStatus = {
  isGitRepo: false,
  branch: null,
  staged: [],
  modified: [],
  untracked: [],
};
