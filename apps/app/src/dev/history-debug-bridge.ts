/**
 * Client-side helper for the `/_dev/history` debug panel (Phase 6, slice 6.1).
 *
 * Wraps the 5 dev-only HTTP endpoints exposed by
 * `apps/server/src/dev/history-debug-handler.ts`. The server self-skips
 * registration when `OPENWORK_DEV_MODE !== "1"`, and the page that mounts
 * this bridge double-checks the env at the React layer.
 */
import { useOpenworkServer } from "../react-app/domains/connections/openwork-server-provider";

export type DevSnapshot = {
  id: string;
  workspaceId: string;
  filePath: string;
  contentHash: string;
  content: string;
  size: number;
  createdAt: number;
  trigger: "auto" | "manual";
  revision: string | null;
};

export type DevSnapshotListResponse = { items: DevSnapshot[] };
export type DevSnapshotCountResponse = { count: number };
export type DevSnapshotLatestResponse = { snapshot: DevSnapshot | null };
export type DevSnapshotSaveResponse = {
  snapshot: DevSnapshot;
  deduped: boolean;
  trimmed: number;
};
export type DevSnapshotDeleteResponse = { ok: boolean };

async function buildHeaders(token: string | undefined): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function useDevHistoryBridge() {
  const server = useOpenworkServer();
  const snapshot = server.getSnapshot();
  const base = snapshot.openworkServerBaseUrl.replace(/\/+$/, "");
  const token = snapshot.openworkServerAuth.token;

  return {
    base,
    isReady: Boolean(base),
    // Real API routes (slice 6.3) — used by the dev panel.
    save: async (input: {
      workspaceId: string;
      filePath: string;
      content: string;
      trigger?: "auto" | "manual";
    }): Promise<DevSnapshotSaveResponse> => {
      const params = new URLSearchParams({ path: input.filePath });
      const response = await fetch(
        `${base}/workspace/${encodeURIComponent(input.workspaceId)}/history/snapshot?${params.toString()}`,
        {
          method: "POST",
          headers: await buildHeaders(token),
          body: JSON.stringify({ content: input.content, trigger: input.trigger ?? "manual" }),
        },
      );
      if (!response.ok) {
        throw new Error(`history/snapshot failed: ${response.status}`);
      }
      return response.json();
    },
    list: async (input: { workspaceId: string; filePath: string; limit?: number }): Promise<DevSnapshotListResponse> => {
      const params = new URLSearchParams({ path: input.filePath });
      if (input.limit) params.set("limit", String(input.limit));
      const response = await fetch(
        `${base}/workspace/${encodeURIComponent(input.workspaceId)}/history?${params.toString()}`,
        { headers: await buildHeaders(token) },
      );
      if (!response.ok) throw new Error(`history failed: ${response.status}`);
      return response.json();
    },
    getContent: async (input: { workspaceId: string; filePath: string; snapshotId: string }): Promise<{ content: string }> => {
      const params = new URLSearchParams({ path: input.filePath });
      const response = await fetch(
        `${base}/workspace/${encodeURIComponent(input.workspaceId)}/history/${encodeURIComponent(input.snapshotId)}/content?${params.toString()}`,
        { headers: await buildHeaders(token) },
      );
      if (!response.ok) throw new Error(`history/content failed: ${response.status}`);
      return response.json();
    },
    restore: async (input: { workspaceId: string; filePath: string; snapshotId: string }): Promise<{ ok: boolean; newRevision: string }> => {
      const params = new URLSearchParams({ path: input.filePath });
      const response = await fetch(
        `${base}/workspace/${encodeURIComponent(input.workspaceId)}/history/${encodeURIComponent(input.snapshotId)}/restore?${params.toString()}`,
        {
          method: "POST",
          headers: await buildHeaders(token),
          body: JSON.stringify({}),
        },
      );
      if (!response.ok) throw new Error(`history/restore failed: ${response.status}`);
      return response.json();
    },
    // Dev-only legacy bridge routes (slice 6.1) — used by the count tile
    // and delete row, which don't have real-API equivalents yet.
    count: async (input: { workspaceId: string; filePath?: string }): Promise<DevSnapshotCountResponse> => {
      const params = new URLSearchParams({ workspaceId: input.workspaceId });
      if (input.filePath) params.set("filePath", input.filePath);
      const response = await fetch(`${base}/dev/history/count?${params.toString()}`, {
        headers: await buildHeaders(token),
      });
      if (!response.ok) throw new Error(`dev/history/count failed: ${response.status}`);
      return response.json();
    },
    remove: async (input: { workspaceId: string; snapshotId: string }): Promise<DevSnapshotDeleteResponse> => {
      const params = new URLSearchParams(input);
      const response = await fetch(`${base}/dev/history/snapshot?${params.toString()}`, {
        method: "DELETE",
        headers: await buildHeaders(token),
      });
      if (!response.ok) throw new Error(`dev/history/snapshot DELETE failed: ${response.status}`);
      return response.json();
    },
  };
}
