/** @jsxImportSource react */
import * as React from "react";
import { Archive, CalendarClock, Plus, PlugZap, Search, Server, Sparkles } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { isMacPlatform } from "../../../../app/utils";
import { t } from "../../../../i18n";

const SEARCH_KEY_SHORTCUT_LABEL = isMacPlatform() ? "\u2318\u21E7F" : "Ctrl+Shift+F";
const SEARCH_KEY_SHORTCUT = isMacPlatform() ? "Meta+Shift+F" : "Control+Shift+F";

export type QuickActionsGroupProps = {
  /** Currently selected workspace id. When empty, "New task" falls back to opening the create-workspace flow. */
  selectedWorkspaceId: string;
  /** Disable "New task" while a workspace is connecting/loading (mirrors the existing `newTaskDisabled` flag). */
  newTaskDisabled: boolean;
  /** Create a new task in the selected workspace. */
  onCreateTask: () => void;
  /** Open the create-workspace modal (used as fallback when no workspace is selected). */
  onOpenCreateWorkspace: () => void;
  /** Open the cross-session search dialog (Cmd/Ctrl+Shift+F). */
  onOpenSearch: () => void;
  /** Open Settings → Skills/Extensions. */
  onOpenSkills?: () => void;
  /** Open Settings → Scheduled tasks. */
  onOpenScheduled?: () => void;
  /** Open Settings → Remote access / Connect Mobile. */
  onOpenConnectMobile?: () => void;
  /** Open MCP Server dashboard. */
  onOpenMcpDashboard?: () => void;
  /** Open Artifacts dashboard. */
  onOpenArtifactsDashboard?: () => void;
  className?: string;
};

/**
 * Top-of-sidebar quick actions: New task, Search, Skills, Scheduled, Connect Mobile.
 *
 * This is the M1 milestone described in
 * `docs/plan-sidebar-quick-actions-and-scheduled.md`. Skills / Scheduled / Connect Mobile
 * currently route into Settings (the underlying Settings pages either exist or land in
 * the M2 milestone). When backend features land, only the wiring in `session-route.tsx`
 * needs to change — the buttons themselves stay stable.
 */
export function QuickActionsGroup(props: QuickActionsGroupProps) {
  const hasWorkspace = Boolean(props.selectedWorkspaceId.trim());
  // Disabled only reflects the upstream "workspace connecting/loading" flag.
  // No-workspace is handled by the click handler (opens create-workspace modal)
  // per plan §2.2 — the button stays visually enabled so the user can click it.
  const newTaskDisabled = props.newTaskDisabled;
  // No-workspace fallback: open the create-workspace modal so the user can pick one
  // before creating a task. Mirrors the plan §2.2 spec.
  const handleNewTaskClick = () => {
    if (!hasWorkspace) {
      props.onOpenCreateWorkspace();
      return;
    }
    props.onCreateTask();
  };

  return (
    <SidebarGroup className={cn("py-1", props.className)}>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleNewTaskClick}
              disabled={newTaskDisabled}
              title={
                !hasWorkspace
                  ? t("workspace_list.quick_actions_new_task_no_workspace")
                  : undefined
              }
              aria-label={t("workspace_list.quick_actions_new_task")}
              data-testid="quick-action-new-task"
            >
              <span
                className="flex size-5 items-center justify-center rounded-full border border-sidebar-foreground/40 text-sidebar-foreground/80"
                aria-hidden
              >
                <Plus className="size-3.5" />
              </span>
              <span className="flex-1 truncate">{t("workspace_list.quick_actions_new_task")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={props.onOpenSearch}
              aria-keyshortcuts={SEARCH_KEY_SHORTCUT}
              aria-label={t("workspace_list.quick_actions_search")}
              data-testid="quick-action-search"
            >
              <Search className="size-4" />
              <span className="flex-1 truncate">{t("workspace_list.quick_actions_search")}</span>
              <kbd className="ml-auto font-sans text-[11px] tracking-wide text-sidebar-foreground/50">
                {SEARCH_KEY_SHORTCUT_LABEL}
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {props.onOpenSkills ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenSkills}
                aria-label={t("workspace_list.quick_actions_skills")}
                data-testid="quick-action-skills"
              >
                <Sparkles className="size-4" />
                <span className="flex-1 truncate">{t("workspace_list.quick_actions_skills")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}

          {props.onOpenScheduled ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenScheduled}
                aria-label={t("workspace_list.quick_actions_scheduled")}
                data-testid="quick-action-scheduled"
              >
                <CalendarClock className="size-4" />
                <span className="flex-1 truncate">{t("workspace_list.quick_actions_scheduled")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}

          {props.onOpenMcpDashboard ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenMcpDashboard}
                aria-label="MCP Server"
                data-testid="quick-action-mcp-server"
              >
                <Server className="size-4" />
                <span className="flex-1 truncate">MCP Server</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}

          {props.onOpenArtifactsDashboard ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenArtifactsDashboard}
                aria-label="Artifacts"
                data-testid="quick-action-artifacts"
              >
                <Archive className="size-4" />
                <span className="flex-1 truncate">Artifacts</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}

          {props.onOpenConnectMobile ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={props.onOpenConnectMobile}
                aria-label={t("workspace_list.quick_actions_connect_mobile")}
                data-testid="quick-action-connect-mobile"
              >
                <PlugZap className="size-4" />
                <span className="flex-1 truncate">{t("workspace_list.quick_actions_connect_mobile")}</span>
                <span
                  className="ml-auto shrink-0 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/40"
                  data-testid="quick-action-coming-soon"
                  title={t("workspace_list.quick_actions_coming_soon_hint")}
                >
                  {t("workspace_list.quick_actions_coming_soon")}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
