/** @jsxImportSource react */
import * as React from "react";
import type { WorkspaceConnectionState } from "../../../../app/types";

export type SidebarContextValue = {
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  developerMode: boolean;
  showSessionActions?: boolean;
  sessionStatusById?: Record<string, string>;
  newTaskDisabled: boolean;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  onSelectWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onOpenRenameSession?: (sessionId: string) => void;
  onOpenDeleteSession?: (sessionId: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  onOpenCreateGroupModal?: (workspaceId: string) => void;
  onOpenRenameWorkspace: (workspaceId: string) => void;
  onShareWorkspace: (workspaceId: string) => void;
  onRevealWorkspace: (workspaceId: string) => void;
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  /** Quick actions group: navigate to Settings → Skills/Extensions. */
  onOpenSkills?: () => void;
  /** Quick actions group: navigate to Settings → Scheduled tasks. */
  onOpenScheduled?: () => void;
  /** Quick actions group: navigate to Settings → Remote access / Connect Mobile. */
  onOpenConnectMobile?: () => void;
  /** Open MCP Server dashboard in external browser. */
  onOpenMcpDashboard?: () => void;
  onOpenArtifactsDashboard?: () => void;
  expandWorkspace: (workspaceId: string) => void;
  toggleWorkspaceExpanded: (workspaceId: string) => void;
  toggleSessionExpanded: (sessionId: string) => void;
  expandedWorkspaceIds: Set<string>;
  expandedSessionIds: Set<string>;
};

export const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebarContext() {
  const context = React.use(SidebarContext);
  if (!context) throw new Error("useSidebarContext must be used within SidebarProvider");
  return context;
}
