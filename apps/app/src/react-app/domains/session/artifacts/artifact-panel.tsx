/** @jsxImportSource react */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, FolderOpen, RefreshCw, X } from "lucide-react";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { getDesktopFileIcon, openDesktopPath, revealDesktopItemInDir } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatFileSize } from "@/lib/utils";
import { type ArtifactPanelTab, usePanelTabStore } from "../panel/panel-tab-store";
import { isCollectibleArtifactTarget, type BinaryData, type Data, type OpenTarget, type OpenTargetPreview, type TextData } from "./open-target";
import { MAX_TEXT_PREVIEW_BYTES } from "./preview-limits";
import { AudioPreview, CodePreview, DiffPreview, HTMLPreview, ImagePreview, MarkdownPreview, PdfPreview, PlainText, PreviewError, PreviewLoading, PreviewUnavailable, VideoPreview } from "./preview";
import { DiffViewer } from "./viewers/diff-viewer";
import { DocumentViewer } from "./viewers/document-viewer";
import { SlidesViewer } from "./viewers/slides-viewer";
import { HistoryStatusBadge } from "./history-status-badge";

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

  // Auto-reload: poll file mtime and invalidate query when it changes.
  // Pauses when tab is hidden or when user is editing the artifact inline.
  useEffect(() => {
    if (target.kind !== "file") return;
    if (isTextContent(target) && editing) return;
    const currentUpdatedAt = data?.updatedAt;
    if (currentUpdatedAt == null) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      try {
        const stat = await client.statWorkspaceFile(workspaceId, target.value);
        if (cancelled) return;
        if (stat.updatedAt != null && stat.updatedAt > currentUpdatedAt) {
          await queryClient.invalidateQueries({
            queryKey: ["artifact-panel", workspaceId, target.id],
          });
          toast.info(`Đã cập nhật: ${target.name}`, {
            description: "File thay đổi trên đĩa, preview đã tự reload.",
            duration: 3000,
          });
        }
      } catch {
        // File may be missing, locked, or workspace disconnected — ignore.
      }
    };

    const interval = window.setInterval(poll, 3000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    client,
    workspaceId,
    target,
    data?.updatedAt,
    editing,
    queryClient,
  ]);

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
  }, [target.id, workspaceId]);

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
        <div className="flex h-10 items-center gap-2 pe-2 ps-4">
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            {fileIcon ? (
              <img src={fileIcon} alt="" className="h-4 w-4 shrink-0 object-contain" />
            ) : null}
            <h3 className="min-w-0 truncate text-sm font-medium text-foreground">
              {target.name}
            </h3>
            <span className="shrink-0 text-xs text-muted-foreground">
              {target.exists === false ? "missing" : target.size !== undefined ? `${formatFileSize(target.size)}` : ""}
            </span>
            {target.kind === "file" ? (
              <HistoryStatusBadge
                client={client}
                workspaceId={workspaceId}
                filePath={target.value}
              />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close artifact">
                  <X />
                </Button>
              )}
            />
            <TooltipContent>Close artifact</TooltipContent>
          </Tooltip>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading || (data?.kind === "binary" && !binaryObjectUrl) ? (
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
          <DiffViewer diff={data.data} />
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
