import { useEffect, useRef } from "react";

import type { OpenworkSessionGroupState } from "@/app/lib/openwork-server";
import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import {
  applySessionGroupServerState,
  beginSessionGroupServerSync,
  setSessionGroupSyncHandler,
  useSessionManagementStore,
  type SessionGroupDefinition,
  type SessionGroupServerState,
  type WorkspaceGroupState,
} from "@/react-app/domains/session/sidebar/session-management-store";
import type { RouteWorkspace } from "./route-workspaces";

const MIGRATION_PREFIX = "openwork.sessionGroups.migrated.v2";

type UseSessionGroupSyncInput = {
  workspaces: RouteWorkspace[];
  endpointForWorkspace: (workspace: RouteWorkspace | null | undefined) => ResolvedWorkspaceEndpoint | null;
};

function hasGroupData(state: SessionGroupServerState | WorkspaceGroupState | undefined): boolean {
  return Boolean(state && (state.groups.length > 0 || Object.keys(state.assignments).length > 0));
}

function serverStateFromWorkspaceState(state: WorkspaceGroupState): OpenworkSessionGroupState {
  return {
    groups: state.groups.map((group) => ({ id: group.id, label: group.label })),
    assignments: { ...state.assignments },
  };
}

function localGroupStateForWorkspace(
  workspace: RouteWorkspace,
  endpoint: ResolvedWorkspaceEndpoint,
): WorkspaceGroupState | undefined {
  const byWorkspace = useSessionManagementStore.getState().groupsByWorkspace;
  const ids = [workspace.id, endpoint.workspaceId, `rem_${endpoint.workspaceId}`];
  for (const id of ids) {
    const state = byWorkspace[id];
    if (hasGroupData(state)) return state;
  }
  return undefined;
}

function migrationKey(endpoint: ResolvedWorkspaceEndpoint): string {
  return `${MIGRATION_PREFIX}:${endpoint.baseUrl}:${endpoint.workspaceId}`;
}

function readMigrationComplete(endpoint: ResolvedWorkspaceEndpoint): boolean {
  try {
    return window.localStorage.getItem(migrationKey(endpoint)) === "1";
  } catch {
    return false;
  }
}

function writeMigrationComplete(endpoint: ResolvedWorkspaceEndpoint): void {
  try {
    window.localStorage.setItem(migrationKey(endpoint), "1");
  } catch {
    // ignore storage failures; the next launch can retry safely.
  }
}

export function useSessionGroupSync(input: UseSessionGroupSyncInput): void {
  const { workspaces, endpointForWorkspace } = input;
  const workspacesRef = useRef(workspaces);
  const endpointForWorkspaceRef = useRef(endpointForWorkspace);
  const eventCursorByWorkspaceRef = useRef<Record<string, number | null>>({});
  const pollInFlightRef = useRef(false);
  const consecutiveFailureCountByWorkspaceRef = useRef<Record<string, number>>({});
  const lastFailureAtByWorkspaceRef = useRef<Record<string, number>>({});
  const initialSyncLogKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    endpointForWorkspaceRef.current = endpointForWorkspace;
  }, [endpointForWorkspace]);

  useEffect(() => {
    setSessionGroupSyncHandler({
      createGroup: async (workspaceId: string, group: SessionGroupDefinition) => {
        const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
        const endpoint = endpointForWorkspaceRef.current(workspace);
        if (!endpoint) return null;
        const response = await endpoint.client.createSessionGroup(endpoint.workspaceId, group);
        writeMigrationComplete(endpoint);
        return response.state;
      },
      assignGroup: async (workspaceId: string, sessionId: string, groupId: string | null) => {
        const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
        const endpoint = endpointForWorkspaceRef.current(workspace);
        if (!endpoint) return null;
        const response = await endpoint.client.assignSessionGroup(endpoint.workspaceId, sessionId, groupId);
        writeMigrationComplete(endpoint);
        return response.state;
      },
      reorderGroups: async (workspaceId: string, groupIds: string[]) => {
        const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
        const endpoint = endpointForWorkspaceRef.current(workspace);
        if (!endpoint) return null;
        const response = await endpoint.client.reorderSessionGroups(endpoint.workspaceId, groupIds);
        writeMigrationComplete(endpoint);
        return response.state;
      },
      removeGroup: async (workspaceId: string, groupId: string) => {
        const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
        const endpoint = endpointForWorkspaceRef.current(workspace);
        if (!endpoint) return null;
        const response = await endpoint.client.removeSessionGroup(endpoint.workspaceId, groupId);
        writeMigrationComplete(endpoint);
        return response.state;
      },
    });
    return () => setSessionGroupSyncHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncWorkspace = async (workspace: RouteWorkspace, migrateLocal: boolean) => {
      const endpoint = endpointForWorkspace(workspace);
      if (!endpoint) return;
      const version = beginSessionGroupServerSync(workspace.id);

      const response = await endpoint.client.getSessionGroups(endpoint.workspaceId);
      if (cancelled) return;

      let nextState = response.state;
      const localState = localGroupStateForWorkspace(workspace, endpoint);
      if (
        migrateLocal &&
        !readMigrationComplete(endpoint) &&
        !hasGroupData(response.state) &&
        localState !== undefined
      ) {
        const migrated = await endpoint.client.putSessionGroups(
          endpoint.workspaceId,
          serverStateFromWorkspaceState(localState),
        );
        if (cancelled) return;
        nextState = migrated.state;
      }

      writeMigrationComplete(endpoint);
      applySessionGroupServerState(workspace.id, nextState, version);
    };

    for (const workspace of workspaces) {
      void syncWorkspace(workspace, true).catch((error) => {
        // Log at most once per (workspace, error message) so a dead local
        // server doesn't fill the console on every effect re-run / poll.
        const message = error instanceof Error ? error.message : String(error);
        const logKey = `${workspace.id}:${message}`;
        if (initialSyncLogKeysRef.current.has(logKey)) return;
        initialSyncLogKeysRef.current.add(logKey);
        console.warn("[session-groups] initial sync failed", error);
      });
    }

    const pollEvents = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        for (const workspace of workspacesRef.current) {
          const endpoint = endpointForWorkspaceRef.current(workspace);
          if (!endpoint) continue;
          const key = `${endpoint.baseUrl}:${endpoint.workspaceId}`;
          const currentCursor = eventCursorByWorkspaceRef.current[key];
          // Track per-workspace consecutive failures so a dead/unreachable
          // server doesn't get hammered every 3s forever — back off
          // exponentially up to 60s and reset on the first success.
          const failureKey = `${key}:failures`;
          const consecutiveFailures =
            (consecutiveFailureCountByWorkspaceRef.current[failureKey] ?? 0);
          if (consecutiveFailures > 0) {
            const backoffMs = Math.min(60_000, 1_000 * Math.pow(2, consecutiveFailures - 1));
            const lastFailureAt = lastFailureAtByWorkspaceRef.current[failureKey] ?? 0;
            if (Date.now() - lastFailureAt < backoffMs) continue;
          }
          try {
            const response = await endpoint.client.listSessionGroupEvents(
              endpoint.workspaceId,
              typeof currentCursor === "number" ? { since: currentCursor } : undefined,
            );
            if (cancelled) return;
            consecutiveFailureCountByWorkspaceRef.current[failureKey] = 0;
            lastFailureAtByWorkspaceRef.current[failureKey] = 0;
            eventCursorByWorkspaceRef.current[key] =
              typeof response.cursor === "number"
                ? response.cursor
                : Math.max(currentCursor ?? 0, ...((response.items ?? []).map((item) => Number(item.seq) || 0)));
            if (currentCursor === undefined || currentCursor === null) continue;
            if ((response.items ?? []).length === 0) continue;
            await syncWorkspace(workspace, false);
          } catch {
            consecutiveFailureCountByWorkspaceRef.current[failureKey] = consecutiveFailures + 1;
            lastFailureAtByWorkspaceRef.current[failureKey] = Date.now();
            // Best effort: normal workspace/session loading still surfaces connection issues.
          }
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void pollEvents();
    const interval = window.setInterval(() => void pollEvents(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [endpointForWorkspace, workspaces]);
}
