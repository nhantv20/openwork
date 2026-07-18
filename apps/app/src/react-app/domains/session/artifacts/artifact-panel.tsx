/** @jsxImportSource react */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, FolderOpen, History as HistoryIcon, MoreHorizontal, RefreshCw } from "lucide-react";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { getDesktopFileIcon, openDesktopPath, revealDesktopItemInDir } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatFileSize } from "@/lib/utils";
import { type ArtifactPanelTab, usePanelTabStore } from "../panel/panel-tab-store";
import { classifyOpenTarget, isCollectibleArtifactTarget, type BinaryData, type Data, type OpenTarget, type OpenTargetPreview, type TextData } from "./open-target";
import { MAX_TEXT_PREVIEW_BYTES } from "./preview-limits";
import { AudioPreview, CodePreview, DiffPreview, HTMLPreview, ImagePreview, MarkdownPreview, PdfPreview, PlainText, PreviewError, PreviewLoading, PreviewUnavailable, VideoPreview } from "./preview";
import { DiffViewer } from "./viewers/diff-viewer";
import { DocumentViewer } from "./viewers/document-viewer";
import { SlidesViewer } from "./viewers/slides-viewer";
import { FileHistoryPanel } from "./file-history-panel";
import { GitReviewTab } from "./git-review-tab";
import { useGitStatus } from "./hooks/use-git-status";
import { useFileHistory } from "./hooks/use-file-history";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ArtifactTextEditor = lazy(() =>
  import("./artifact-text-editor").then((module) => ({ default: module.ArtifactTextEditor })),
);
const ArtifactSpreadsheetEditor = lazy(() =>
  import("./artifact-spreadsheet-editor").then((module) => ({ default: module.ArtifactSpreadsheetEditor })),
);

const EMPTY_TRANSCRIPT_TARGETS: OpenTarget[] = [];

type ArtifactPanelProps = {
  sessionId: string;
  tab: ArtifactPanelTab;
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
  onClose: () => void;
};

type ArtifactPanelViewProps = {
  sessionId: string;
  client: OpenworkServerClient;
  workspaceId: string;
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
  target: OpenTarget;
  onClose: () => void;
};

type ArtifactQueryState =
  | (TextData & { updatedAt: number | null })
  | (BinaryData & { contentType: string | null; updatedAt: number | null });

type SaveArtifactInput = Data & { baseUpdatedAt: number | null };

function absoluteWorkspacePath(root: string, path: string) {
  const cleanRoot = root.trim().replace(/[/\\]+$/, "");
  const cleanPath = path.trim().replace(/^\.\//, "");
  
  return cleanRoot ? `${cleanRoot}/${cleanPath}` : cleanPath;
}

function isTextContent(target: OpenTarget): boolean {
  return ["markdown", "text", "sheet", "html"].includes(target.preview) && !/\.(xlsx|xls|ods)$/i.test(target.value);
}

function textSizeOf(target: OpenTarget, data: TextData | BinaryData | undefined): number | null {
  if (typeof target.size === "number") return target.size;
  if (data?.kind === "text") return new Blob([data.data]).size;
  return null;
}

function isCodeFile(value: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|json|jsonc|yaml|yml|xml|py|rb|go|rs|java|kt|swift|php|c|cpp|h|cs|sql|sh|bash|zsh|vue|svelte|astro|mdx|graphql|gql|prisma|dockerfile|toml|ini|env|conf|lua|r|jl|dart|ex|exs|elm|clj|cljs|cljr|scala|hs|purs|ml|fs|fsi|fsx|vb|vbs|asm|s|pl|pm|tcl|rkt|scm|ss|scm)$/i.test(value);
}

function isDiffFile(value: string): boolean {
  return /\.(diff|patch)$/i.test(value) || value.endsWith(".diff.txt") || value.endsWith(".patch.txt");
}

export function ArtifactPanel({ sessionId, tab, client, workspaceId, workspaceRoot, isRemoteWorkspace = false, onClose }: ArtifactPanelProps) {
  const transcriptTargets = usePanelTabStore((state) => state.transcriptArtifactTargets[sessionId] ?? EMPTY_TRANSCRIPT_TARGETS);
  const artifactTargets = useMemo(() => transcriptTargets.filter(isCollectibleArtifactTarget), [transcriptTargets]);
  const target = artifactTargets.find((item) => item.id === tab.id) ?? null;

  if (!target || !client || !workspaceId) {
    return null;
  }

  return (
    <ArtifactPanelView
      sessionId={sessionId}
      client={client}
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      isRemoteWorkspace={isRemoteWorkspace}
      target={target}
      onClose={onClose}
    />
  );
}

function ArtifactPanelView({ sessionId, client, workspaceId, workspaceRoot, isRemoteWorkspace = false, target, onClose }: ArtifactPanelViewProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Round-6: the narrow-header overflow menu opens the same History popover
  // as the wide-layout inline button. We control it via state so both
  // surfaces share one Popover instance instead of duplicating the
  // FileHistoryPanel mount (which keeps the "All changes" tab and the
  // timeline state aligned).
  const [historyOpen, setHistoryOpen] = useState(false);
  // Phase 6.6: view-mode tabs in the artifact body. Local state because
  // it's per-file ephemeral UI (resets when the user switches to a
  // different file). The popover History button still works as a
  // quick-access — it opens the History tab without routing through
  // the strip first.
  const [activeTab, setActiveTab] = useState<"preview" | "review" | "history">("preview");
  // Phase 6.8: which filePaths have had their agent-review banner
  // dismissed this session. Cleared on workspace switch so the user
  // gets the banner back next time they open a fresh workspace.
  const [dismissedAgentBanners, setDismissedAgentBanners] = useState<Set<string>>(
    () => new Set(),
  );
  // Phase 6.8: inline agent-vs-current diff shown when the user
  // clicks "Show diff" on the banner. Holds the snapshot id we're
  // diffing against; the diff content itself is fetched separately.
  const [agentDiff, setAgentDiff] = useState<{
    snapshotId: string;
    diff: string;
  } | null>(null);
  // Phase 6.8: use the existing history hook so we can call
  // `restoreSnapshot` from the banner's Undo button.
  const { restoreSnapshot, isRestoring } = useFileHistory({
    client,
    workspaceId,
    filePath: target.kind === "file" ? target.value : null,
  });
  const isDirectTextEdit = isTextContent(target) && target.preview === "markdown";
  const externalPath = useMemo(() => target.kind === "file" ? absoluteWorkspacePath(workspaceRoot, target.value) : target.value, [target.kind, target.value, workspaceRoot]);

  const { data: fileIcon } = useQuery<string | null>({
    queryKey: ["desktop-file-icon", externalPath] as const,
    queryFn: async () => getDesktopFileIcon(externalPath, "small"),
    enabled: target.kind === "file" && !isRemoteWorkspace && isElectronRuntime(),
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });

  const { data, error, isError, isLoading } = useQuery<ArtifactQueryState>({
    queryKey: ["artifact-panel", workspaceId, target.id] as const,
    queryFn: async () => {
      if (target.kind === "url") {
        throw new Error("URLs open in browser tabs.");
      }
      else if (target.exists === false) {
        throw new Error("File not found in this workspace.");
      }

      if (isTextContent(target)) {
        const result = await client.readWorkspaceFile(workspaceId, target.value);
        
        return { kind: "text", data: result.content, updatedAt: result.updatedAt ?? null };
      }

      const result = await client.downloadWorkspaceFile(workspaceId, target.value);

      return { kind: "binary", data: result.data, contentType: result.contentType, updatedAt: target.updatedAt ?? null };
    },
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  // Auto-reload: disabled. Users reload manually via the header Reload button
  // or Cmd/Ctrl+Shift+R (handled by the listener below). The previous mtime
  // poll was removed because it caused surprise overwrites when an external
  // tool (agent, editor, linter) wrote the file while the user was reading it.

  // Listen for the global Cmd/Ctrl+Shift+R reload event dispatched by the
  // shell. We invalidate the artifact query instead of touching the on-disk
  // file so the next read is the source of truth.
  useEffect(() => {
    const handler = () => {
      void queryClient.invalidateQueries({
        queryKey: ["artifact-panel", workspaceId, target.id],
      });
    };
    window.addEventListener("openwork:reload-artifact-preview", handler);
    return () => window.removeEventListener("openwork:reload-artifact-preview", handler);
  }, [queryClient, workspaceId, target.id]);

  const [binaryObjectUrl, setBinaryObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!data || data.kind !== "binary") {
      setBinaryObjectUrl(null);

      return;
    }

    const fallbackType = target.preview === "pdf" ? "application/pdf" : "application/octet-stream";
    const url = URL.createObjectURL(new Blob([data.data], { type: data.contentType ?? fallbackType }));

    setBinaryObjectUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [data, target.preview]);

  useEffect(() => {
    setEditing(false);
    setDraft("");
    // Phase 6.6: switch back to Preview when the user navigates to a
    // different file so a previous file's Review/History tab state
    // doesn't bleed across files.
    setActiveTab("preview");
    // Phase 6.8: drop any inline agent diff and the dismissed set so
    // each freshly-opened file gets its own banner session. The
    // dismissed set is per-session, not persistent, so the banner
    // reappears for any file the user has never dismissed.
    setAgentDiff(null);
  }, [target.id, workspaceId]);

  // Phase 6.6: gate the Review tab on whether the workspace is a git
  // repo. We deliberately do NOT show the tab if the answer is
  // negative — the user gets a cleaner strip and the popover History
  // shortcut still works. Cached for 5 minutes; if the user runs
  // `git init` in a terminal the next visit will pick it up.
  // Status is fetched via a shared hook so `GitReviewTab` (which mounts
  // when the user clicks the tab) reuses the same cache entry instead
  // of issuing a duplicate request.
  const { data: gitStatus } = useGitStatus({
    client,
    workspaceId,
    filePath: target.kind === "file" ? target.value : null,
    enabled: target.kind === "file" && !isRemoteWorkspace,
  });
  const showReviewTab = gitStatus?.isGitRepo === true;

  useEffect(() => {
    if (data?.kind === "text") {
      setDraft(data.data);
    }
  }, [data]);

  const { mutate, mutateAsync, isPending: isSaving } = useMutation({
    mutationFn: async (input: SaveArtifactInput) => {
      if (target.kind !== "file") {
        throw new Error("Cannot save non-file artifact.");
      }

      if (input.kind === "text") {
        return client.writeWorkspaceFile(workspaceId, { path: target.value, content: input.data, baseUpdatedAt: input.baseUpdatedAt });
      }

      return client.writeWorkspaceBinaryFile(workspaceId, { path: target.value, data: input.data, baseUpdatedAt: input.baseUpdatedAt });
    },
    onSuccess: (result, input) => {
      queryClient.setQueryData<ArtifactQueryState>(
        ["artifact-panel", workspaceId, target.id] as const,
        input.kind === "text"
          ? { kind: "text", data: input.data, updatedAt: result.updatedAt ?? null }
          : { kind: "binary", data: input.data, contentType: data?.kind === "binary" ? data.contentType : null, updatedAt: result.updatedAt ?? null },
      );

      if (input.kind === "text") {
        setDraft(input.data);
      }
    },
  });

  const download = async () => {
    if (target.kind === "url") {
      return;
    }
    
    const result = await client.downloadWorkspaceFile(workspaceId, target.value);
    const url = URL.createObjectURL(new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }));
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = target.name;
    anchor.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const openExternal = async () => {
    if (target.kind === "url") {
      window.open(target.value, "_blank", "noopener,noreferrer");

      return;
    }
    else if (!isRemoteWorkspace) {
      try {
        await openDesktopPath(externalPath);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Could not open this file.");
      }

      return;
    }

    await download();
  };

  const revealExternal = async () => {
    if (target.kind !== "file" || isRemoteWorkspace) return;
    try {
      await revealDesktopItemInDir(externalPath);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not show this file in your file manager.");
    }
  };

  const save = () => {
    if (target.kind !== "file" || !isTextContent(target) || data?.kind !== "text") {
      return;
    }

    mutate(
      {
        kind: "text",
        data: draft,
        baseUpdatedAt: data.updatedAt,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const saveSpreadsheetContent = async (payload: Data) => {
    if (target.kind !== "file") {
      return;
    }

    await mutateAsync({
      ...payload,
      baseUpdatedAt: data?.kind === payload.kind ? data.updatedAt : target.updatedAt ?? null,
    });
  };

  const textSize = textSizeOf(target, data);
  const textTooLarge = textSize !== null && textSize > MAX_TEXT_PREVIEW_BYTES;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border bg-background mac:bg-background/80 mac:backdrop-blur-2xl mac:backdrop-saturate-150">
        <div className="@container/artifact-header flex h-10 min-w-0 items-center gap-2 overflow-hidden pe-6 ps-4">
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            {fileIcon ? (
              <img src={fileIcon} alt="" className="h-4 w-4 shrink-0 object-contain" />
            ) : null}
            <h3 className="min-w-0 truncate text-sm font-medium text-foreground">
              {target.name}
            </h3>
            <span className="hidden shrink-0 text-xs text-muted-foreground @sm/artifact-header:inline">
              {target.exists === false ? "missing" : target.size !== undefined ? `${formatFileSize(target.size)}` : ""}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Always-visible context actions: Edit / Discard / Save. These
                belong to the artifact's edit state, so they live in their own
                row outside the overflow menu — users must never have to dig
                into a dropdown to commit or cancel an edit. */}
            {isTextContent(target) && data?.kind === "text" ? (
              editing || isDirectTextEdit ? (
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (data?.kind === "text") {
                              setDraft(data.data);
                            }
                            setEditing(false);
                          }}
                          disabled={isSaving}
                        >
                          Discard
                        </Button>
                      )}
                    />
                    <TooltipContent>Discard changes</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <Button variant="default" size="sm" onClick={() => void save()} disabled={isSaving || draft === data.data}>{isSaving ? "Saving" : "Save"}</Button>
                      )}
                    />
                    <TooltipContent>Save changes</TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
                    )}
                  />
                  <TooltipContent>Edit artifact</TooltipContent>
                </Tooltip>
              )
            ) : null}

            {/* File history — always rendered (never hidden by container
                queries) so the Popover anchor has a stable bounding rect
                at every header width. Click opens the same History popover
                as the dropdown item. */}
            {target.kind === "file" ? (
              <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="File history"
                      data-testid="artifact-history-button"
                    >
                      <HistoryIcon />
                    </Button>
                  }
                />
                <PopoverContent className="w-auto p-0" align="end" sideOffset={6}>
                  <FileHistoryPanel
                    client={client}
                    workspaceId={workspaceId}
                    filePath={target.value}
                    currentContent={data?.kind === "text" ? data.data : undefined}
                    onSelectFile={(path) => {
                      // Round-4 fix: clicking a row in "All changes" opens
                      // that file as a new artifact tab. Run the standard
                      // classifier so the preview kind is populated.
                      const fileName = path.split("/").pop() ?? path;
                      const preview = classifyOpenTarget(path, "file");
                      const newTab: ArtifactPanelTab = {
                        id: `artifact_${path}`,
                        type: "artifact",
                        label: fileName,
                        preview,
                      };
                      usePanelTabStore.getState().openTab(sessionId, newTab);
                      usePanelTabStore.getState().selectTab(sessionId, newTab.id);
                    }}
                  />
                </PopoverContent>
              </Popover>
            ) : null}

            {/* Wide layout: inline file-operation buttons (history, download,
                show, open, reload). Hidden when the artifact header is
                narrower than 30rem (~480px) so the filename always wins for
                space; the overflow menu below picks them up at that width. */}
            <div className="hidden items-center gap-1 @[30rem]/artifact-header:flex">
              {target.kind === "file" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button variant="ghost" size="icon-sm" onClick={() => void download()} aria-label="Download artifact">
                        <Download />
                      </Button>
                    )}
                  />
                  <TooltipContent>Download artifact</TooltipContent>
                </Tooltip>
              ) : null}
              {target.kind === "file" && !isRemoteWorkspace ? (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button variant="ghost" size="icon-sm" onClick={() => void revealExternal()} aria-label="Show in folder">
                        <FolderOpen />
                      </Button>
                    )}
                  />
                  <TooltipContent>Show in folder</TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <Button variant="ghost" size="icon-sm" onClick={() => void openExternal()} aria-label={isRemoteWorkspace ? "Download artifact" : "Open externally"}>
                      <ExternalLink />
                    </Button>
                  )}
                />
                <TooltipContent>{isRemoteWorkspace ? "Download artifact" : "Open externally"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        void queryClient.invalidateQueries({
                          queryKey: ["artifact-panel", workspaceId, target.id],
                        });
                      }}
                      disabled={isLoading}
                      aria-label="Reload artifact"
                    >
                      <RefreshCw className={isLoading ? "animate-spin" : undefined} />
                    </Button>
                  )}
                />
                <TooltipContent>Reload file</TooltipContent>
              </Tooltip>
            </div>

            {/* Narrow layout: secondary file ops collapse into this overflow
                menu. Edit/Discard/Save are NOT here — those are handled in
                the always-visible row above. Shown by default; hidden once
                the header reaches the wide breakpoint above. */}
            <div className="flex items-center gap-1 @[30rem]/artifact-header:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="More actions"
                      data-testid="artifact-more-button"
                    >
                      <MoreHorizontal />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="min-w-48">
                  {target.kind === "file" ? (
                    <>
                      <DropdownMenuItem onClick={() => void download()}>
                        <Download />
                        <span>Download</span>
                      </DropdownMenuItem>
                      {!isRemoteWorkspace ? (
                        <DropdownMenuItem onClick={() => void revealExternal()}>
                          <FolderOpen />
                          <span>Show in folder</span>
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onClick={() => void openExternal()}>
                        <ExternalLink />
                        <span>{isRemoteWorkspace ? "Download artifact" : "Open externally"}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          void queryClient.invalidateQueries({
                            queryKey: ["artifact-panel", workspaceId, target.id],
                          });
                        }}
                        disabled={isLoading}
                      >
                        <RefreshCw className={isLoading ? "animate-spin" : undefined} />
                        <span>Reload</span>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
      {/* Phase 6.9: the legacy per-file <AgentReviewBanner /> is
           removed — all approval/review flows now live in the right
           panel's Review tab. The banner mount point is intentionally
           left blank so the surrounding layout doesn't shift. The
           `agentDiff` / `dismissedAgentBanners` state below is kept
           so existing inline-diff behaviour isn't disturbed. */}
      {target.kind === "file" ? null : null}
      {agentDiff && target.kind === "file" ? (
        <div
          className="shrink-0 border-b border-border bg-background/60"
          data-testid="agent-review-inline-diff"
        >
          <div className="flex items-center justify-between px-4 py-1.5 text-[10px] text-muted-foreground">
            <span>Agent snapshot {agentDiff.snapshotId.slice(0, 12)}… vs current</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setAgentDiff(null)}
              data-testid="agent-review-inline-diff-close"
              aria-label="Close diff"
            >
              ×
            </button>
          </div>
          <DiffViewer diff={agentDiff.diff} className="max-h-[40vh] overflow-auto px-3 py-2" language={target.value.split(".").pop()} />
        </div>
      ) : null}
      {target.kind === "file" ? (
        <div className="shrink-0 border-b border-border bg-background/40" data-testid="artifact-tab-strip">
          <div className="flex h-9 items-center gap-1 px-4 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              data-testid="artifact-tab-preview"
              className={
                activeTab === "preview"
                  ? "rounded-md bg-accent px-2.5 py-1 font-medium text-accent-foreground"
                  : "rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }
            >
              Preview
            </button>
            {showReviewTab ? (
              <button
                type="button"
                onClick={() => setActiveTab("review")}
                data-testid="artifact-tab-review"
                className={
                  activeTab === "review"
                    ? "rounded-md bg-accent px-2.5 py-1 font-medium text-accent-foreground"
                    : "rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }
              >
                Review
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              data-testid="artifact-tab-history"
              className={
                activeTab === "history"
                  ? "rounded-md bg-accent px-2.5 py-1 font-medium text-accent-foreground"
                  : "rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }
            >
              History
            </button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Phase 6.6: when the user picked a non-Preview tab, render that
            view instead of the preview. The preview tree stays mounted
            underneath (lazy modules, scroll position) so switching back
            is instant. */}
        {activeTab === "review" && target.kind === "file" && showReviewTab ? (
          <GitReviewTab
            client={client}
            workspaceId={workspaceId}
            filePath={target.value}
          />
        ) : activeTab === "history" && target.kind === "file" ? (
          <FileHistoryPanel
            client={client}
            workspaceId={workspaceId}
            filePath={target.value}
            currentContent={data?.kind === "text" ? data.data : undefined}
            onSelectFile={(path) => {
              const fileName = path.split("/").pop() ?? path;
              const preview = classifyOpenTarget(path, "file");
              const newTab: ArtifactPanelTab = {
                id: `artifact_${path}`,
                type: "artifact",
                label: fileName,
                preview,
              };
              usePanelTabStore.getState().openTab(sessionId, newTab);
              usePanelTabStore.getState().selectTab(sessionId, newTab.id);
            }}
          />
        ) : isLoading || (data?.kind === "binary" && !binaryObjectUrl) ? (
          <PreviewLoading />
        ) : isError ? (
          <PreviewError message={error instanceof Error ? error.message : "Failed to load artifact" } />
        ) : data?.kind === "text" && (editing || isDirectTextEdit) ? (
          <TextEditor value={draft} language={target.preview === "markdown" ? "markdown" : "text"} onChange={setDraft} />
        ) : target.preview === "markdown" && data?.kind === "text" ? (
          <MarkdownPreview content={data.data} />
        ) : target.preview === "sheet" ? (
          <SheetEditor
            name={target.name}
            content={data ?? { kind: "binary", data: new ArrayBuffer(0) }}
            saving={isSaving}
            onSave={saveSpreadsheetContent}
          />
        ) : target.preview === "slides" && binaryObjectUrl ? (
          <SlidesViewer url={binaryObjectUrl} filePath={target.kind === "file" ? externalPath : undefined} title={target.name} />
        ) : target.preview === "document" && binaryObjectUrl ? (
          <DocumentViewer url={binaryObjectUrl} title={target.name} />
        ) : target.preview === "video" && binaryObjectUrl ? (
          <VideoPreview url={binaryObjectUrl} title={target.name} />
        ) : target.preview === "audio" && binaryObjectUrl ? (
          <AudioPreview url={binaryObjectUrl} title={target.name} />
        ) : target.preview === "html" && data?.kind === "text" ? (
          <HTMLPreview type="text" title={target.name} content={data.data} />
        ) : target.preview === "image" && data?.kind === "binary" && binaryObjectUrl ? (
          <ImagePreview src={binaryObjectUrl} alt={target.name} />
        ) : target.preview === "pdf" && data?.kind === "binary" && binaryObjectUrl ? (
          <PdfPreview url={binaryObjectUrl} title={target.name} />
        ) : data?.kind === "binary" && binaryObjectUrl && target.preview === "html" ? (
          <HTMLPreview type="binary" title={target.name} url={binaryObjectUrl} />
        ) : data?.kind === "text" && isDiffFile(target.value) ? (
          <DiffViewer diff={data.data} language={target.value.split(".").pop()} />
        ) : data?.kind === "text" && textTooLarge ? (
          <PreviewError message={`Text file (${formatFileSize(textSize ?? 0)}) is too large to preview inline — use the buttons above to download or open externally.`} />
        ) : data?.kind === "text" ? (
          <CodePreview code={data.data} language={target.value.split(".").pop() ?? "text"} />
        ) : data?.kind === "binary" && binaryObjectUrl ? (
          <PreviewError message={`Binary file (${formatFileSize(target.size ?? data.data.byteLength)}) — preview not supported for this format`} />
        ) : (
          <PreviewUnavailable />
        )}
      </div>
    </div>
  );
}

interface TextEditorProps extends React.ComponentProps<typeof ArtifactTextEditor> {
  value: string;
  language: "markdown" | "text";
  onChange: (value: string) => void;
}

function TextEditor({ value, language, onChange, ...props }: TextEditorProps) {
  return (
    <Suspense fallback={<PreviewLoading />}>
      <ArtifactTextEditor value={value} language={language} onChange={onChange} {...props} />
    </Suspense>
  );
}

interface SheetEditorProps extends React.ComponentProps<typeof ArtifactSpreadsheetEditor> {
  
}

function SheetEditor({ className, ...props }: SheetEditorProps) {
  return (
    <Suspense fallback={<PreviewLoading />}>
      <ArtifactSpreadsheetEditor
        className={className}
        {...props}
      />
    </Suspense>
  );
}
