/** @jsxImportSource react */
/**
 * Phase 6, slice 6.4 — `useFileHistory` hook.
 *
 * Mirrors AionUi's `usePreviewHistory` semantics (see WBS round-1 review):
 *   - Returns early (no API call) when workspaceId or filePath is undefined.
 *   - No loading flash when both inputs are present (the query starts
 *     immediately; consumers handle isLoading from React Query).
 *   - Exposes manual save + restore mutations.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type {
  OpenworkFileSnapshot,
  OpenworkServerClient,
} from "@/app/lib/openwork-server";

type UseFileHistoryInput = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  filePath: string | null;
  limit?: number;
};

type UseFileHistoryResult = {
  history: OpenworkFileSnapshot[];
  historyLoading: boolean;
  historyError: Error | null;
  saveManualSnapshot: (content: string) => Promise<OpenworkFileSnapshot>;
  isSaving: boolean;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  isRestoring: boolean;
};

export function useFileHistory(input: UseFileHistoryInput): UseFileHistoryResult {
  const { client, workspaceId, filePath, limit = 50 } = input;
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => ["file-history", workspaceId, filePath, limit] as const,
    [workspaceId, filePath, limit],
  );

  const historyQuery = useQuery<OpenworkFileSnapshot[]>({
    queryKey,
    queryFn: async () => {
      if (!client || !workspaceId || !filePath) return [];
      const res = await client.listFileHistory(workspaceId, filePath, { limit });
      return res.items;
    },
    enabled: Boolean(client && workspaceId && filePath),
    staleTime: 5_000,
  });

  const saveMutation = useMutation<OpenworkFileSnapshot, Error, string>({
    mutationFn: async (content) => {
      if (!client || !workspaceId || !filePath) {
        throw new Error("Cannot save snapshot: missing workspace or file path");
      }
      const result = await client.saveFileSnapshot(workspaceId, filePath, content, "manual");
      return result.snapshot;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const restoreMutation = useMutation<void, Error, string>({
    mutationFn: async (snapshotId) => {
      if (!client || !workspaceId || !filePath) {
        throw new Error("Cannot restore snapshot: missing workspace or file path");
      }
      await client.restoreFileSnapshot(workspaceId, filePath, snapshotId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    history: historyQuery.data ?? [],
    historyLoading: historyQuery.isLoading,
    historyError: historyQuery.error as Error | null,
    saveManualSnapshot: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    restoreSnapshot: restoreMutation.mutateAsync,
    isRestoring: restoreMutation.isPending,
  };
}
