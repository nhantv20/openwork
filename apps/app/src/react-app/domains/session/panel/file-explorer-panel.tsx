/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, File, Folder, FolderOpen, Loader2 } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import type { OpenTargetPreview } from "../artifacts/open-target";
import { classifyOpenTarget } from "../artifacts/open-target";
import { cn } from "@/lib/utils";

interface FileExplorerPanelProps {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  workspaceRoot: string;
  onFileSelect?: (path: string, preview: OpenTargetPreview) => void;
  onClose?: () => void;
}

interface TreeNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children: TreeNode[];
  isExpanded: boolean;
}

interface FlatNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  index: number;
}

function buildTree(
  items: Array<{ name: string; path: string; kind: "file" | "dir" }>,
  expandedPaths: Set<string>,
): TreeNode[] {
  const dirs: Record<string, TreeNode> = {};
  const root: TreeNode[] = [];

  const sorted = [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of sorted) {
    const node: TreeNode = item.kind === "dir"
      ? { name: item.name, path: item.path, kind: "directory", children: [], isExpanded: expandedPaths.has(item.path) }
      : { name: item.name, path: item.path, kind: "file", children: [], isExpanded: false };

    if (item.kind === "dir") {
      dirs[item.path] = node;
    }

    const parentPath = item.path.includes("/")
      ? item.path.substring(0, item.path.lastIndexOf("/"))
      : "";

    if (parentPath && dirs[parentPath]) {
      dirs[parentPath].children.push(node);
    } else {
      root.push(node);
    }
  }

  return root;
}

function flattenTree(nodes: TreeNode[], expandedPaths: Set<string>, depth = 0, index = 0): FlatNode[] {
  const result: FlatNode[] = [];

  for (const node of nodes) {
    result.push({
      name: node.name,
      path: node.path,
      kind: node.kind,
      depth,
      isExpanded: expandedPaths.has(node.path),
      hasChildren: node.kind === "directory" && node.children.length > 0,
      index: index++,
    });

    if (node.kind === "directory" && expandedPaths.has(node.path)) {
      const sub = flattenTree(node.children, expandedPaths, depth + 1, index);
      index = sub.length > 0 ? sub[sub.length - 1].index + 1 : index;
      result.push(...sub);
    }
  }

  return result;
}

function FileNode({
  node,
  onToggle,
  onSelect,
  isSelected,
}: {
  node: FlatNode;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  isSelected: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 cursor-pointer hover:bg-accent rounded-sm px-1 py-0.5 text-sm select-none",
        isSelected && "bg-accent",
      )}
      style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
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
        <>
          <span className="size-3 shrink-0" />
          <File className="size-3.5 shrink-0 text-muted-foreground" />
        </>
      )}
      <span className="truncate">{node.name}</span>
    </div>
  );
}

export function FileExplorerPanel({ client, workspaceId, workspaceRoot, onFileSelect, onClose }: FileExplorerPanelProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);

  const projectName = useMemo(() => {
    const parts = workspaceRoot.split("/");
    return parts[parts.length - 1] || "Project";
  }, [workspaceRoot]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["workspace-dir", workspaceId, ""] as const,
    queryFn: () => client!.listWorkspaceDirectory(workspaceId!, ""),
    enabled: !!client && !!workspaceId,
  });

  useEffect(() => {
    if (data?.items) {
      const newTree = buildTree(data.items, expandedPaths);
      setTree(newTree);

      const rootDirs = newTree.filter((n) => n.kind === "directory").map((n) => n.path);
      if (rootDirs.length > 0 && expandedPaths.size === 0) {
        const initialExpanded = new Set(rootDirs.slice(0, 2));
        setExpandedPaths(initialExpanded);
        for (const dir of initialExpanded) {
          void loadDirChildren(dir);
        }
      }
    }
  }, [data]);

  const loadDirChildren = useCallback(
    async (path: string) => {
      if (!client || !workspaceId) return;
      try {
        const result = await client.listWorkspaceDirectory(workspaceId, path);
        const children = buildTree(result.items, expandedPaths);

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
        console.error("Failed to load directory:", path, err);
      }
    },
    [client, workspaceId, expandedPaths],
  );

  const expandDir = useCallback(
    async (path: string) => {
      await loadDirChildren(path);
      setExpandedPaths((prev) => new Set([...prev, path]));
    },
    [loadDirChildren],
  );

  const toggleDir = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });

    setTree((prev) => {
      const toggleInTree = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map((n) => {
          if (n.path === path && n.kind === "directory") {
            return { ...n, isExpanded: !n.isExpanded };
          }
          if (n.children.length > 0) {
            return { ...n, children: toggleInTree(n.children) };
          }
          return n;
        });
      };
      return toggleInTree(prev);
    });
  }, []);

  const handleToggle = useCallback(
    (path: string) => {
      if (expandedPaths.has(path)) {
        toggleDir(path);
      } else {
        expandDir(path);
      }
    },
    [expandedPaths, toggleDir, expandDir],
  );

  const selectFile = useCallback(
    (path: string) => {
      const preview = classifyOpenTarget(path, "file");
      setSelectedPath(path);
      onFileSelect?.(path, preview);
    },
    [onFileSelect],
  );

  const flatNodes = useMemo(() => flattenTree(tree, expandedPaths), [tree, expandedPaths]);

  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 10,
  });

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
    return (
      <div className="flex flex-col h-full">
        <div className="p-2 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FolderOpen className="size-4 text-amber-9" />
            <span>{projectName}</span>
          </div>
        </div>
        <div className="flex-1 p-4 text-sm text-muted-foreground">
          Unable to load files
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FolderOpen className="size-4 text-amber-9" />
          <span>{projectName}</span>
        </div>
      </div>
      <div ref={parentRef} className="flex-1 overflow-auto py-1">
        {flatNodes.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No files</div>
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
                    isSelected={selectedPath === node.path}
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
