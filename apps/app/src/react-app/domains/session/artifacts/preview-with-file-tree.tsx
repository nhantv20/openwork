/** @jsxImportSource react */
import { useMemo } from "react";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { ArtifactPanel } from "./artifact-panel";
import { FileExplorerPanel } from "../panel/file-explorer-panel";
import { usePanelTabStore, useSessionActiveTabId, useSessionPanelTabs } from "../panel/panel-tab-store";
import type { OpenTarget, OpenTargetPreview } from "./open-target";
import { classifyOpenTarget } from "./open-target";

interface PreviewWithFileTreeProps {
  sessionId: string;
  client: OpenworkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
  onClose: () => void;
}

export function PreviewWithFileTree({
  sessionId,
  client,
  workspaceId,
  workspaceRoot,
  isRemoteWorkspace = false,
  onClose,
}: PreviewWithFileTreeProps) {
  // These selectors must use module-level EMPTY constants as their missing-key
  // fallback. Inline `?? []` returns a brand-new array on every render, which
  // breaks `useSyncExternalStore`'s snapshot-stability contract and triggers
  // "The result of getSnapshot should be cached" + "Maximum update depth
  // exceeded" the moment the panel-tab store has no entry for the session
  // (typical after a connection refusal on cold start).
  const activeTabId = useSessionActiveTabId(sessionId);
  const tabs = useSessionPanelTabs(sessionId);

  const activeArtifactTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId && t.type === "artifact"),
    [tabs, activeTabId],
  );

  const handleFileSelect = (path: string, preview: OpenTargetPreview) => {
    if (!sessionId) return;
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
  };

  if (!activeArtifactTab || activeArtifactTab.type !== "artifact") {
    return (
      <div className="flex h-full min-h-0">
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          Select a file to preview
        </div>
        <div className="w-72 shrink-0 border-l border-border">
          <FileExplorerPanel
            client={client}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            onFileSelect={handleFileSelect}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 flex-1 overflow-hidden">
        <ArtifactPanel
          sessionId={sessionId}
          tab={activeArtifactTab}
          client={client}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          isRemoteWorkspace={isRemoteWorkspace}
          onClose={onClose}
        />
      </div>
      <div className="w-72 shrink-0 border-l border-border">
        <FileExplorerPanel
          client={client}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          onFileSelect={handleFileSelect}
        />
      </div>
    </div>
  );
}