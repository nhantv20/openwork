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
    save: async (input: {
      workspaceId: string;
      filePath: string;
      content: string;
      trigger?: "auto" | "manual";
    }): Promise<DevSnapshotSaveResponse> => {
      const response = await fetch(`${base}/dev/history/snapshot`, {
        method: "POST",
        headers: await buildHeaders(token),
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`dev/history/snapshot failed: ${response.status}`);
      }
      return response.json();
    },
    list: async (input: { workspaceId: string; filePath: string; limit?: number }): Promise<DevSnapshotListResponse> => {
      const params = new URLSearchParams({
        workspaceId: input.workspaceId,
        filePath: input.filePath,
      });
      if (input.limit) params.set("limit", String(input.limit));
      const response = await fetch(`${base}/dev/history/list?${params.toString()}`, {
        headers: await buildHeaders(token),
      });
      if (!response.ok) throw new Error(`dev/history/list failed: ${response.status}`);
      return response.json();
    },
    count: async (input: { workspaceId: string; filePath?: string }): Promise<DevSnapshotCountResponse> => {
      const params = new URLSearchParams({ workspaceId: input.workspaceId });
      if (input.filePath) params.set("filePath", input.filePath);
      const response = await fetch(`${base}/dev/history/count?${params.toString()}`, {
        headers: await buildHeaders(token),
      });
      if (!response.ok) throw new Error(`dev/history/count failed: ${response.status}`);
      return response.json();
    },
    latest: async (input: { workspaceId: string; filePath: string }): Promise<DevSnapshotLatestResponse> => {
      const params = new URLSearchParams(input);
      const response = await fetch(`${base}/dev/history/latest?${params.toString()}`, {
        headers: await buildHeaders(token),
      });
      if (!response.ok) throw new Error(`dev/history/latest failed: ${response.status}`);
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
