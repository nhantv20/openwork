/** @jsxImportSource react */
import * as React from "react";
import { FileText, Folder, Globe, Mic2, MoreHorizontal, Settings2, X } from "lucide-react";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useUiStateStore } from "../../../shell/ui-state-store";
import type { SidePanelItem } from "../../../shell/ui-state-store";
import { FileExplorerPanel } from "./file-explorer-panel";
import { SidePanel } from "./side-panel";
import { ArtifactPanel } from "../artifacts/artifact-panel";
import { VoicePanel } from "../voice/voice-panel";
import {
  usePanelTabStore,
  useSessionActiveTabId,
  useSessionPanelTabs,
} from "./panel-tab-store";
import { classifyOpenTarget, type OpenTarget, type OpenTargetPreview } from "../artifacts/open-target";

type RightPanelMode = "files" | "preview" | "browser";

const SHORTCUT_HINT = navigator.platform.toLowerCase().includes("mac")
  ? "⌘⌥1 · ⌘⌥2 · ⌘⌥3"
  : "Ctrl+Alt+1 · Ctrl+Alt+2 · Ctrl+Alt+3";

const PRIMARY_MODES: ReadonlyArray<{ mode: RightPanelMode; label: string; icon: React.ComponentType<{ size?: number }>; shortcut: string }> = [
  { mode: "files", label: "Files", icon: Folder, shortcut: SHORTCUT_HINT.split(" · ")[0] },
  { mode: "preview", label: "Preview", icon: FileText, shortcut: SHORTCUT_HINT.split(" · ")[1] },
  { mode: "browser", label: "Browser", icon: Globe, shortcut: SHORTCUT_HINT.split(" · ")[2] },
];

export type RightPanelProps = {
  sessionId: string;
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
  /** Render slot for extensions panel (rendered when mode = "extensions"). */
  extensionsSlot?: React.ReactNode;
  /** Called when the user clicks the close (×) button in the header. */
  onClose: () => void;
  /** Called when a file preview opens (tree click, chat mention). Used to grow the panel. */
  onFilePreviewOpen?: () => void;
};

/**
 * Right side panel with a 3-button toggle header (Files / Preview / Browser).
 *
 * Behaviour:
 * - Click an inactive button → switch to that mode.
 * - Click the active button → close the panel (set state to null).
 * - Click × → close the panel.
 * - `extensions` and `voice` modes are also supported (rendered in the body)
 *   but the toggle buttons in the header only cover the 3 primary modes.
 *   Voice/Extensions are still reachable via the existing rail buttons.
 */
export function RightPanel({
  sessionId,
  client,
  workspaceId,
  workspaceRoot,
  isRemoteWorkspace = false,
  extensionsSlot,
  onClose,
  onFilePreviewOpen,
}: RightPanelProps) {
  const mode = useUiStateStore((state) => state.sidePanelState[sessionId] ?? null);
  const setMode = useUiStateStore((state) => state.setSidePanelState);
  const toggleModeState = useUiStateStore((state) => state.toggleSidePanelState);

  // Read the active artifact tab so we can show ArtifactPanel full-width in
  // Preview mode (no more side-by-side tree — the tree lives in Files mode).
  const tabs = useSessionPanelTabs(sessionId);
  const activeTabId = useSessionActiveTabId(sessionId);
  const activeArtifactTab = React.useMemo(
    () => tabs.find((t) => t.id === activeTabId && t.type === "artifact"),
    [tabs, activeTabId],
  );

  const setModeForSession = React.useCallback(
    (panel: SidePanelItem | null) => {
      setMode(sessionId, panel);
    },
    [sessionId, setMode],
  );

  const toggleMode = React.useCallback(
    (target: RightPanelMode) => {
      // "browser" shares the same panel slot as the legacy "panel" mode —
      // both render the SidePanel with browser/artifact tabs.
      if (target === "browser") {
        // Make sure there's at least one browser tab so the panel isn't empty.
        const hasBrowserTab = usePanelTabStore
          .getState()
          .sessions[sessionId]?.tabs.some((tab) => tab.type === "browser");
        if (!hasBrowserTab && typeof window !== "undefined") {
          void window.__OPENWORK_ELECTRON__?.browser?.createTab?.();
        }
        toggleModeState(sessionId, "panel");
        return;
      }
      toggleModeState(sessionId, target);
    },
    [sessionId, toggleModeState],
  );

  const handleFileSelect = React.useCallback(
    (path: string, preview: OpenTargetPreview) => {
      if (!workspaceId) return;
      const fileId = `file:${path.toLowerCase()}`;
      const name = path.includes("/") ? path.substring(path.lastIndexOf("/") + 1) : path;
      const target: OpenTarget = {
        id: fileId,
        kind: "file",
        value: path,
        name,
        preview,
        confidence: 100,
        reason: "file_explorer",
        exists: true,
      };
      usePanelTabStore.getState().syncTranscriptArtifacts(sessionId, [target]);
      usePanelTabStore.getState().openTab(sessionId, {
        id: fileId,
        type: "artifact",
        label: name,
        preview,
      });
      setModeForSession("preview");
      onFilePreviewOpen?.();
    },
    [sessionId, workspaceId, setModeForSession, onFilePreviewOpen],
  );

  return (
    <TooltipProvider delay={400}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background px-2 mac:bg-background/80 mac:backdrop-blur-2xl mac:backdrop-saturate-150">
          <div className="flex flex-1 items-center gap-0.5">
            {PRIMARY_MODES.map(({ mode: m, label, icon: Icon, shortcut }) => {
              // "browser" lives in the "panel" slot — see toggleMode.
              const active = m === "browser" ? mode === "panel" : mode === m;
              return (
                <Tooltip key={m}>
                  <TooltipTrigger
                    render={(
                      <Button
                        variant={active ? "default" : "ghost"}
                        size="sm"
                        className={cn(
                          "h-7 gap-1.5 px-2 text-xs",
                          !active && "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => toggleMode(m)}
                        aria-label={`${label} (${shortcut})`}
                        aria-pressed={active}
                      >
                        <Icon size={14} />
                        <span className="hidden md:inline">{label}</span>
                      </Button>
                    )}
                  />
                  <TooltipContent>
                    {label} · {shortcut}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <DropdownMenuTrigger
                    render={(
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="More panel options"
                      >
                        <MoreHorizontal />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipContent>Voice · Extensions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setModeForSession(mode === "voice" ? null : "voice")}
              >
                <Mic2 />
                {mode === "voice" ? "Đóng Voice Mode" : "Mở Voice Mode"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setModeForSession(mode === "extensions" ? null : "extensions")}
              >
                <Settings2 />
                {mode === "extensions" ? "Đóng Extensions" : "Mở Extensions"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  aria-label="Close panel"
                >
                  <X />
                </Button>
              )}
            />
            <TooltipContent>Close panel</TooltipContent>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {mode === "extensions" && extensionsSlot ? (
            <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
              {extensionsSlot}
            </div>
          ) : mode === "voice" ? (
            <VoicePanel
              client={client}
              workspaceId={workspaceId}
              sessionId={sessionId}
              onClose={onClose}
            />
          ) : mode === "files" ? (
            <FileExplorerPanel
              client={client}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              sessionId={sessionId}
              onFileSelect={handleFileSelect}
              onClose={onClose}
            />
          ) : mode === "preview" ? (
            activeArtifactTab && activeArtifactTab.type === "artifact" && client && workspaceId ? (
              <ArtifactPanel
                sessionId={sessionId}
                tab={activeArtifactTab}
                client={client}
                workspaceId={workspaceId}
                workspaceRoot={workspaceRoot}
                isRemoteWorkspace={isRemoteWorkspace}
                onClose={onClose}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <FileText className="size-8 opacity-40" />
                <p className="font-medium">Chưa có file nào đang mở</p>
                <p className="text-xs">
                  Chuyển sang <span className="font-semibold">Files</span> để chọn file từ workspace,
                  hoặc click vào file mention trong chat.
                </p>
              </div>
            )
          ) : mode === "panel" ? (
            <SidePanel
              sessionId={sessionId}
              client={client}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              isRemoteWorkspace={isRemoteWorkspace}
              onClose={onClose}
            />
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
