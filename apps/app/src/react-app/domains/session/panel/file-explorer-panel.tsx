/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ExternalLink, File, Folder, FolderOpen, Loader2, MoreHorizontal, RefreshCw, Search, X } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import type { OpenTargetPreview } from "../artifacts/open-target";
import { classifyOpenTarget } from "../artifacts/open-target";
import { openDesktopFileInEditor, revealDesktopItemInDir } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useFileExplorerStore, useWorkspaceExpandedPaths } from "./file-explorer-store";
import {
  buildTree,
  collectDirectoryPaths,
  findMatchingTreePath,
  flattenTree,
  isInExcludedDir,
  pathMatchesQuery,
  type FlatNode,
  type TreeNode,
} from "./file-explorer-helpers";
import { useRepoGitStatus } from "../artifacts/hooks/use-repo-git-status";

const EDITOR_OPTIONS: ReadonlyArray<{ id: string; label: string; command: string }> = [
  { id: "vscode", label: "VS Code", command: "code" },
  { id: "cursor", label: "Cursor", command: "cursor" },
  { id: "sublime", label: "Sublime Text", command: "subl" },
  { id: "webstorm", label: "WebStorm", command: "webstorm" },
  { id: "idea", label: "IntelliJ IDEA", command: "idea" },
  { id: "nvim", label: "Neovim", command: "nvim" },
  { id: "vim", label: "Vim", command: "vim" },
];

type GitStatusForNode = "staged" | "modified" | "untracked";

function getFileIcon(name: string): { Icon: React.ComponentType<{ className?: string }>; color: string } {
  // Per-extension icons were removed for visual consistency. All files use
  // the generic file icon; only directories get a distinct folder icon.
  return { Icon: File, color: "text-muted-foreground" };
}

function EditorIcon({ id, className }: { id: string; className?: string }) {
  // Inline brand-style icons (16x16) so the dropdown row matches the look of
  // platform launchers like VS Code's "Open With" menu.
  switch (id) {
    case "vscode":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="#007ACC"
            d="M17.583 3.13a1.5 1.5 0 0 1 1.45.066l1.39.886a1.5 1.5 0 0 1 .667 1.252v13.332a1.5 1.5 0 0 1-.667 1.252l-1.39.886a1.5 1.5 0 0 1-1.575-.07L7 13.96v2.79a1.5 1.5 0 0 1-2.317 1.252l-1.4-.96A1.5 1.5 0 0 1 2.5 16.04V7.96a1.5 1.5 0 0 1 .783-1.302l1.4-.66A1.5 1.5 0 0 1 7 7.25v2.79l10.583-6.91Z"
          />
        </svg>
      );
    case "cursor":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="currentColor"
            d="M21.1 4.1 13.7 2.4a2 2 0 0 0-1.7.4L2.6 9.4a1 1 0 0 0 0 1.5l4 3.2-1.4 1.8a.7.7 0 0 0 .8 1.1l2.4-1.1 3.6 2.9a1 1 0 0 0 1.4-.1l7.4-8.4a2 2 0 0 0 .3-1.7l-1-3.4a2 2 0 0 0-1-1.1Z"
          />
        </svg>
      );
    case "sublime":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="#FF9800"
            d="M3 3h6v6H3V3Zm6 6h6V3H9v6Zm6-6h6v6h-6V3Zm0 6h6v6h-6V9Zm-6 6h6v6H9v-6Zm-6 0h6v6H3v-6Z"
          />
        </svg>
      );
    case "webstorm":
    case "idea":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="#087CFA"
            d="M2 12 12 2l10 10-10 10L2 12Zm10 7 7-7-7-7-7 7 7 7Z"
          />
          <path fill="#fff" d="M2 12 12 2l10 10-10 10L2 12Z" opacity=".0" />
        </svg>
      );
    case "nvim":
    case "vim":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="#019733"
            d="M2 3h20v18H2V3Zm2 2v14h16V5H4Zm3 3h2v6H7V8Zm4 0h4v2h-4V8Zm0 4h3v2h-3v-2Z"
          />
        </svg>
      );
    default:
      return <ExternalLink className={className} />;
  }
}

interface FileExplorerPanelProps {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  workspaceRoot: string;
  /**
   * When provided, the file tree highlights and auto-expands the
   * ancestors of the currently open artifact tab from this session.
   * Lets the user see "where this file lives" even when they open it
   * from a chat mention or the tab strip directly.
   */
  sessionId?: string;
  onFileSelect?: (path: string, preview: OpenTargetPreview) => void;
  onClose?: () => void;
}

function FileNode({
  node,
  onToggle,
  onSelect,
  onReveal,
  onOpenInEditor,
  isSelected,
  gitStatus,
}: {
  node: FlatNode;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onReveal: (path: string) => void;
  onOpenInEditor: (path: string, command: string) => void;
  isSelected: boolean;
  gitStatus: GitStatusForNode | null;
}) {
  const statusDot = !gitStatus ? null : gitStatus === "staged" ? (
    <span className="size-1.5 rounded-full bg-green-500 shrink-0" title="Staged" />
  ) : gitStatus === "modified" ? (
    <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Modified" />
  ) : gitStatus === "untracked" ? (
    <span className="size-1.5 rounded-full bg-orange-500 shrink-0" title="Untracked" />
  ) : null;
  const showEditorMenu = isElectronRuntime();
  return (
    <div
      className={cn(
        "group flex items-center gap-1 cursor-pointer rounded-sm px-1 py-0.5 text-sm select-none",
        isSelected ? "bg-accent" : "hover:bg-accent",
      )}
      style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
      draggable={true}
      onDragStart={(event) => {
        // Use a custom MIME type so the composer can recognise this as a file
        // tree drag (vs. a generic OS file drop, which becomes an attachment).
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-openwork-file-path", node.path);
        // Some browsers need plain text as a fallback for cross-app drags.
        event.dataTransfer.setData("text/plain", node.path);
      }}
      onClick={() => (node.kind === "directory" ? onToggle(node.path) : onSelect(node.path))}
    >
      {node.kind === "directory" ? (
        <>
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              node.isExpanded && "rotate-90",
            )}
          />
          {node.isExpanded ? (
            <FolderOpen className="size-3.5 shrink-0 text-amber-9" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-amber-9" />
          )}
        </>
      ) : (
        (() => {
          const { Icon: FileIcon, color: iconColor } = getFileIcon(node.name);
          return (
            <>
              <span className="size-3 shrink-0" />
              <FileIcon className={cn("size-3.5 shrink-0", iconColor)} />
            </>
          );
        })()
      )}
      {statusDot}
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {showEditorMenu ? (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-5"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReveal(node.path);
                  }}
                  aria-label={node.kind === "directory" ? "Reveal in folder" : "Show in folder"}
                >
                  <FolderOpen className="size-3" />
                </Button>
              )}
            />
            <TooltipContent>
              {node.kind === "directory" ? "Reveal in folder" : "Show in folder"}
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <DropdownMenuTrigger
                    render={(
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-5"
                        onClick={(event) => event.stopPropagation()}
                        aria-label="Open in editor"
                      >
                        <MoreHorizontal className="size-3" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipContent>Open in editor</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Open in</DropdownMenuLabel>
                {EDITOR_OPTIONS.map((editor) => (
                  <DropdownMenuItem
                    key={editor.id}
                    onSelect={() => onOpenInEditor(node.path, editor.command)}
                  >
                    <EditorIcon id={editor.id} className="size-4" />
                    {editor.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => onOpenInEditor(node.path, "")}>
                  <ExternalLink className="size-3.5" />
                  Open with default app
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}

export function FileExplorerPanel({ client, workspaceId, workspaceRoot, sessionId, onFileSelect, onClose }: FileExplorerPanelProps) {
  const { expanded: expandedPathList, selectedPath } = useWorkspaceExpandedPaths(workspaceId);
  // Memoised Set view, keyed off the array identity. Using a freshly-built
  // Set inline would change its reference every render and break
  // `useEffect([expandedPaths])` dep arrays (causing an infinite loop).
  const expandedPaths = useMemo(() => new Set(expandedPathList), [expandedPathList]);
  const toggleExpanded = useFileExplorerStore((state) => state.toggleExpanded);
  const expandMany = useFileExplorerStore((state) => state.expand);
  const collapseOne = useFileExplorerStore((state) => state.collapse);
  // Track which directory paths have already been fetched this session so
  // we don't re-issue the same API call when the same dir is requested
  // from multiple places (search effect, panel-tab sync, manual expand,
  // effect-driven restore). Reset only when the workspace changes.
  const loadedDirsRef = useRef<Set<string>>(new Set());
  // Remember the last workspaceId we processed so the data effect can
  // distinguish a real workspace switch from a data refetch for the same
  // workspace. Without this guard every refresh would call setTree(newTree)
  // and wipe the lazy-loaded children that the user is currently looking at.
  const lastWorkspaceIdRef = useRef<string | null>(null);
  const setSelectedPath = useFileExplorerStore((state) => state.setSelected);
  const expandAncestors = useFileExplorerStore((state) => state.expandAncestors);
  const parentRef = useRef<HTMLDivElement>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isReloading, setIsReloading] = useState(false);
  // Snapshot the user-chosen expand state when entering search mode so we can
  // restore it on clear. Avoids stomping on manual expansion while searching.
  // Snapshot lives in a ref so it doesn't trigger re-renders itself.
  const savedExpandedRef = useRef<Set<string> | null>(null);

  const repoGitStatus = useRepoGitStatus({ client, workspaceId });
  const gitStatusMap = useMemo(() => {
    const map = new Map<string, GitStatusForNode>();
    const data = repoGitStatus.data;
    if (!data?.isGitRepo) return map;
    for (const f of data.staged) map.set(f, "staged");
    for (const f of data.modified) {
      if (!map.has(f)) map.set(f, "modified");
    }
    for (const f of data.untracked) {
      if (!map.has(f)) map.set(f, "untracked");
    }
    return map;
  }, [repoGitStatus.data]);

  const projectName = useMemo(() => {
    const parts = workspaceRoot.split("/");
    return parts[parts.length - 1] || "Project";
  }, [workspaceRoot]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["workspace-dir", workspaceId, ""] as const,
    queryFn: () => client!.listWorkspaceDirectory(workspaceId!, ""),
    enabled: !!client && !!workspaceId,
  });

  // Build the root tree from the workspace listing whenever (a) the data
  // changes, or (b) the workspace changes. We do this regardless of whether
  // the user has a persisted expand state, otherwise the tree would be
  // empty for any workspace the user has visited before.
  //
  // The persisted state is only consulted to decide whether to
  // auto-expand the first two root dirs on the user's *first* visit to a
  // workspace — after that the user owns the state.
  useEffect(() => {
    if (!data?.items) return;
    if (!workspaceId) return;

    const persisted = useFileExplorerStore.getState().byWorkspace[workspaceId];
    const isNewWorkspace = lastWorkspaceIdRef.current !== workspaceId;
    lastWorkspaceIdRef.current = workspaceId;

    if (isNewWorkspace) {
      // Real workspace change — wipe the in-memory tree and the
      // loaded-dirs cache so we start from a clean slate.
      loadedDirsRef.current.clear();
      setTree(buildTree(data.items, new Set()));
    }

    // Reload any previously-expanded dirs to keep the tree in sync with
    // persisted state. loadDirChildren is a no-op for dirs already in
    // loadedDirsRef, so refresh / repeated effect runs don't re-issue API
    // calls for dirs the user already has open.
    if (persisted) {
      const expanded = new Set(persisted.expandedPaths);
      for (const dir of persisted.expandedPaths) {
        void loadDirChildren(dir, expanded);
      }
      return;
    }

    if (!isNewWorkspace) return;
    const rootDirs = data.items
      .filter((item) => item.kind === "dir")
      .map((item) => item.path);
    if (rootDirs.length === 0) return;

    const initialExpanded = rootDirs.slice(0, 2);
    expandMany(workspaceId, initialExpanded);
    for (const dir of initialExpanded) {
      void loadDirChildren(dir, new Set(initialExpanded));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, workspaceId]);

  // Note: we intentionally do NOT rebuild the whole tree on every
  // `expandedPaths` change. The previous version did this and it destroyed
  // the tree's lazy-loaded descendants: once the user expanded a root
  // directory, its children list was held in React state via
  // loadDirChildren → setTree. Rebuilding from `data.items` (which only
  // contains the root listing) wiped out every deeper level, so clicking a
  // nested folder did nothing — its node had been thrown away.
  //
  // Instead, individual actions (toggleDir, expandDir, loadDirChildren)
  // update the tree surgically. isExpanded flags get attached to each
  // node as part of buildTree at load time, and the toggle handler flips
  // them in place.

  // Search behaviour: when the query is non-empty, expand every directory so
  // matches nested deep in the tree are reachable, and remember the user's
  // prior expand state so clearing the query restores it. Lazy-load any
  // directory that hasn't been fetched yet so the search actually shows
  // descendants.
  //
  // We skip directories in SEARCH_EXCLUDED_DIRS (node_modules, .git, etc.)
  // because they would dominate the request volume without contributing to
  // search results — the path filter at the display layer still excludes
  // them, so loading them just to hide them wastes bandwidth and time.
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!workspaceId) return;
    if (trimmed.length > 0) {
      if (savedExpandedRef.current === null) {
        savedExpandedRef.current = new Set(expandedPaths);
      }
      const allDirs = collectDirectoryPaths(tree);
      const needExpand = allDirs.filter(
        (p) => !expandedPaths.has(p) && !isInExcludedDir(p),
      );
      if (needExpand.length > 0) {
        const next = new Set(expandedPaths);
        for (const dir of needExpand) next.add(dir);
        expandMany(workspaceId, [...next]);
        for (const dir of needExpand) {
          void loadDirChildren(dir, next);
        }
      }
    } else if (savedExpandedRef.current !== null) {
      // Restore: collapse every directory that wasn't in the snapshot.
      const snapshot = savedExpandedRef.current;
      savedExpandedRef.current = null;
      const toCollapse = [...expandedPaths].filter((p) => !snapshot.has(p));
      for (const dir of toCollapse) {
        collapseOne(workspaceId, dir);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, tree, workspaceId]);

  // Sync the file tree selection with the right-panel's currently open
  // artifact tab. When the user opens a file from a chat mention (or any
  // other non-tree entry point), the tree needs to know about it so the
  // file is highlighted and its ancestors are expanded. We import the panel
  // tab store lazily to avoid a hard dependency from the tree component.
  useEffect(() => {
    if (!sessionId || !workspaceId) return;
    if (tree.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { usePanelTabStore } = await import("./panel-tab-store");
      if (cancelled) return;
      const { sessions } = usePanelTabStore.getState();
      const activeTabId = sessions[sessionId]?.activeTabId;
      if (!activeTabId || !activeTabId.startsWith("file:")) return;
      const filePath = activeTabId.slice("file:".length);
      // The panel store stores paths case-insensitively (lowercased).
      // Only set selectedPath when the file exists in the tree — otherwise
      // the persisted selectedPath from selectFile is already correct.
      const treePath = findMatchingTreePath(tree, filePath);
      if (!treePath) return;
      if (cancelled) return;
      setSelectedPath(workspaceId, treePath);
      const ancestors = expandAncestors(workspaceId, treePath);
      // expandAncestors mutates the store synchronously; re-read the latest
      // expandedPaths instead of using the closure snapshot, otherwise the
      // loadDirChildren calls below would build children with stale
      // isExpanded flags.
      const latestExpanded = new Set(
        useFileExplorerStore.getState().byWorkspace[workspaceId]?.expandedPaths ?? [],
      );
      for (const dir of ancestors) {
        void loadDirChildren(dir, latestExpanded);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, workspaceId, tree]);

  const loadDirChildren = useCallback(
    async (path: string, expanded: Set<string>) => {
      if (!client || !workspaceId) return;
      // Skip API call if we've already loaded this directory in the
      // current session. The tree node already holds the children; the
      // call would just re-issue the same GET. handleReload clears the
      // cache first so the refresh button still does a real reload.
      if (loadedDirsRef.current.has(path)) return;
      loadedDirsRef.current.add(path);
      try {
        const result = await client.listWorkspaceDirectory(workspaceId, path);
        const children = buildTree(result.items, expanded);

        setTree((prev) => {
          const insertChildren = (nodes: TreeNode[]): TreeNode[] => {
            return nodes.map((n) => {
              if (n.path === path && n.kind === "directory") {
                return { ...n, children };
              }
              if (n.children.length > 0) {
                return { ...n, children: insertChildren(n.children) };
              }
              return n;
            });
          };
          return insertChildren(prev);
        });
      } catch (err) {
        // Allow retry on failure — drop the path from the loaded set.
        loadedDirsRef.current.delete(path);
        console.error("Failed to load directory:", path, err);
      }
    },
    [client, workspaceId],
  );

  const expandDir = useCallback(
    async (path: string) => {
      if (!workspaceId) return;
      // Make sure the directory contents are loaded before we mark it expanded,
      // otherwise the tree will show an empty folder.
      await loadDirChildren(path, new Set([...expandedPaths, path]));
      expandMany(workspaceId, [path]);
    },
    [loadDirChildren, expandedPaths, expandMany, workspaceId],
  );

  const toggleDir = useCallback(
    (path: string) => {
      if (!workspaceId) return;
      // Update the persisted expand set first so the Set lookup in
      // flattenTree() reflects the new state on the next render.
      toggleExpanded(workspaceId, path);
      // Also flip the per-node isExpanded flag so chevron + folder-open icons
      // stay in sync. flattenTree reads from the Set, but the per-node flag
      // drives those icons.
      setTree((prev) => {
        const toggleInTree = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map((n) => {
            if (n.path === path && n.kind === "directory") {
              return { ...n, isExpanded: !n.isExpanded };
            }
            if (n.children.length > 0) {
              return { ...n, children: toggleInTree(n.children) };
            }
            return n;
          });
        return toggleInTree(prev);
      });
    },
    [toggleExpanded, workspaceId],
  );

  const handleToggle = useCallback(
    (path: string) => {
      if (expandedPaths.has(path)) {
        toggleDir(path);
      } else {
        void expandDir(path);
      }
    },
    [expandedPaths, toggleDir, expandDir],
  );

  const selectFile = useCallback(
    (path: string) => {
      const preview = classifyOpenTarget(path, "file");
      if (workspaceId) {
        setSelectedPath(workspaceId, path);
        // Auto-expand every ancestor directory so the selected file is
        // actually visible in the tree. This matters when the user clicks
        // a file via a chat mention or other external entry point, and the
        // tree happens to be collapsed above it.
        const ancestors = expandAncestors(workspaceId, path);
        // expandAncestors mutates the store synchronously; re-read the
        // latest expandedPaths instead of using the closure snapshot,
        // otherwise the loadDirChildren calls below would build children
        // with stale isExpanded flags.
        const latestExpanded = new Set(
          useFileExplorerStore.getState().byWorkspace[workspaceId]?.expandedPaths ?? [],
        );
        for (const dir of ancestors) {
          void loadDirChildren(dir, latestExpanded);
        }
      }
      onFileSelect?.(path, preview);
    },
    [onFileSelect, workspaceId, setSelectedPath, expandAncestors, loadDirChildren],
  );

  const absolutePath = useCallback(
    (path: string) => {
      const cleanRoot = workspaceRoot.trim().replace(/[/\\]+$/, "");
      const cleanPath = path.trim().replace(/^\.\//, "");
      if (!cleanPath) return cleanRoot;
      return cleanRoot ? `${cleanRoot}/${cleanPath}` : cleanPath;
    },
    [workspaceRoot],
  );

  const handleReveal = useCallback(
    (path: string) => {
      const target = absolutePath(path);
      revealDesktopItemInDir(target).catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Could not reveal in folder.");
      });
    },
    [absolutePath],
  );

  const handleOpenInEditor = useCallback(
    (path: string, command: string) => {
      const target = absolutePath(path);
      const editorLabel =
        EDITOR_OPTIONS.find((editor) => editor.command === command)?.label ?? (command || "default app");
      openDesktopFileInEditor(target, command)
        .then(() => {
          if (command) {
            toast.success(`Đã mở trong ${editorLabel}`);
          }
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Could not open in editor.");
        });
    },
    [absolutePath],
  );

  const handleReload = useCallback(async () => {
    setIsReloading(true);
    try {
      // Clear the loaded-dirs cache so the upcoming refetch actually
      // re-issues the API calls for every expanded directory. Without
      // this the new "skip if already loaded" guard in loadDirChildren
      // would treat the refresh as a no-op.
      loadedDirsRef.current.clear();
      const paths = [...expandedPaths];
      await refetch();
      await Promise.all(paths.map((dir) => loadDirChildren(dir, new Set(paths))));
    } finally {
      setIsReloading(false);
    }
  }, [refetch, expandedPaths, loadDirChildren]);

  const allFlatNodes = useMemo(() => flattenTree(tree, expandedPaths), [tree, expandedPaths]);
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const flatNodes = useMemo(() => {
    if (!trimmedQuery) return allFlatNodes;
    return allFlatNodes.filter((node) => pathMatchesQuery(node.path, trimmedQuery));
  }, [allFlatNodes, trimmedQuery]);

  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 10,
  });

  const selectedFileIndex = useMemo(() => {
    if (!selectedPath) return -1;
    return flatNodes.findIndex((n) => n.path === selectedPath);
  }, [flatNodes, selectedPath]);

  // Auto-scroll to the selected file only when the selected path actually
  // changes — not when the tree reshuffles. Depending on `selectedFileIndex`
  // (which changes on every expand/collapse because flatNodes reorders)
  // makes the focus jump to the selected file every time the user toggles
  // a folder. Track the path we last scrolled to so we only react to a
  // genuine user-driven selection change.
  const lastScrolledPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPath) {
      lastScrolledPathRef.current = null;
      return;
    }
    if (selectedPath === lastScrolledPathRef.current) return;
    const index = flatNodes.findIndex((n) => n.path === selectedPath);
    if (index < 0) return;
    lastScrolledPathRef.current = selectedPath;
    virtualizer.scrollToIndex(index, { align: "center" });
  }, [selectedPath, flatNodes, virtualizer]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-2 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FolderOpen className="size-4 text-amber-9" />
            <span>{projectName}</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border p-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FolderOpen className="size-4 text-amber-9" />
            <span>{projectName}</span>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <Folder className="size-8 text-muted-foreground/40" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Không load được file</p>
            <p className="text-xs text-muted-foreground">Workspace có thể đang lỗi hoặc mất kết nối.</p>
            <p className="font-mono text-[10px] text-muted-foreground/70">{errorMessage}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refetch();
            }}
          >
            Thử lại
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 border-b border-border p-2 text-sm font-medium">
        <FolderOpen className="size-4 shrink-0 text-amber-9" />
        <span className="min-w-0 flex-1 truncate">{projectName}</span>
        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6"
                onClick={() => void handleReload()}
                aria-label="Refresh file tree"
              >
                <RefreshCw className={cn("size-3.5", isReloading && "animate-spin")} />
              </Button>
            )}
          />
          <TooltipContent>Refresh file tree</TooltipContent>
        </Tooltip>
        {isElectronRuntime() ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    onClick={() => handleReveal("")}
                    aria-label="Open workspace folder"
                  >
                    <FolderOpen className="size-3.5" />
                  </Button>
                )}
              />
              <TooltipContent>Mở folder workspace</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <DropdownMenuTrigger
                      render={(
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-6"
                          aria-label="Open workspace in editor"
                        >
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      )}
                    />
                  )}
                />
                <TooltipContent>Mở workspace trong IDE</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Mở workspace trong</DropdownMenuLabel>
                  {EDITOR_OPTIONS.map((editor) => (
                    <DropdownMenuItem
                      key={editor.id}
                      onSelect={() => handleOpenInEditor("", editor.command)}
                    >
                      <EditorIcon id={editor.id} className="size-4" />
                      {editor.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => handleOpenInEditor("", "")}>
                    <ExternalLink className="size-3.5" />
                    Mở bằng app mặc định
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      <div className="border-b border-border px-2 pb-2 pt-1.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Tìm file trong workspace..."
            className="h-7 pl-7 pr-7 text-xs"
            aria-label="Tìm file"
          />
          {searchQuery.length > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-0.5 top-1/2 size-6 -translate-y-1/2"
                    onClick={() => setSearchQuery("")}
                    aria-label="Xoá tìm kiếm"
                  >
                    <X className="size-3" />
                  </Button>
                )}
              />
              <TooltipContent>Xoá tìm kiếm</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div ref={parentRef} className="flex-1 overflow-auto py-1">
        {flatNodes.length === 0 ? (
          trimmedQuery ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <Search className="size-7 opacity-40" />
              <p className="font-medium">Không tìm thấy file</p>
              <p className="text-xs">Không có kết quả cho "{searchQuery}".</p>
              <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
                Xoá tìm kiếm
              </Button>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <Folder className="size-7 opacity-40" />
              <p className="font-medium">Workspace trống</p>
              <p className="text-xs">Chưa có file nào trong thư mục này.</p>
            </div>
          )
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const node = flatNodes[virtualRow.index];
              return (
                <div
                  key={node.path}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <FileNode
                    node={node}
                    onToggle={handleToggle}
                    onSelect={selectFile}
                    onReveal={handleReveal}
                    onOpenInEditor={handleOpenInEditor}
                    isSelected={selectedPath === node.path}
                    gitStatus={node.kind === "file" ? (gitStatusMap.get(node.path) ?? null) : null}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
