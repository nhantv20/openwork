/** @jsxImportSource react */
/**
 * Phase 6.9: `useFileDiff` — fetch the diff between a file's pre-AI
 * snapshot and its current on-disk content.
 *
 * Rev 2 fix (from the plan review): we diff `parentSnapshotId` →
 * `current`, NOT `snapshotId` → `current`. The latter would diff the
 * AI's own snapshot against the current file, which is a no-op when
 * the file already contains that snapshot's content.
 *
 * When the agent snapshot has no parent (first edit on a brand-new
 * file), the hook returns an empty diff and reports `hasParent: false`
 * so the UI can show an "Initial version" empty state.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";

export type UseFileDiffInput = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  filePath: string | null;
  parentSnapshotId: string | null;
  /** Toggle the query without unmounting the consumer. */
  enabled?: boolean;
};

export type UseFileDiffResult = {
  diff: string;
  hasParent: boolean;
};

const EMPTY: UseFileDiffResult = { diff: "", hasParent: false };

export function useFileDiff({
  client,
  workspaceId,
  filePath,
  parentSnapshotId,
  enabled = true,
}: UseFileDiffInput): UseQueryResult<UseFileDiffResult> {
  return useQuery<UseFileDiffResult>({
    queryKey: [
      "file-diff",
      workspaceId,
      filePath,
      parentSnapshotId,
    ] as const,
    queryFn: async () => {
      if (!client || !workspaceId || !filePath) return EMPTY;
      if (!parentSnapshotId) {
        // No pre-AI snapshot — the file is brand-new, so there is no
        // diff to show. Return an empty string so the UI can render
        // the "initial version" empty state.
        return EMPTY;
      }
      const result = await client.diffFileSnapshots(
        workspaceId,
        filePath,
        parentSnapshotId,
        "current",
      );
      return { diff: result.diff, hasParent: true };
    },
    enabled: enabled && Boolean(client && workspaceId && filePath),
    // Diff content is expensive to compute on the server; cache the
    // result for half a minute so toggling the file expand/collapse
    // does not re-fetch.
    staleTime: 30_000,
    retry: 1,
  });
}
