/**
 * Pure helpers for the file explorer tree. Extracted from
 * `file-explorer-panel.tsx` so they can be unit-tested without mounting the
 * 957-line component.
 *
 * Nothing in this file should import React, the zustand store, or the
 * workspace client — keep the helpers as referentially-transparent
 * functions over plain data so they stay easy to reason about and test.
 */

export interface TreeNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children: TreeNode[];
  isExpanded: boolean;
}

export interface FlatNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  index: number;
}

export function buildTree(
  items: Array<{ name: string; path: string; kind: "file" | "dir" }>,
  expandedPaths: Set<string>,
): TreeNode[] {
  const dirs: Record<string, TreeNode> = {};
  const root: TreeNode[] = [];

  // Two-pass build. A single-pass version that processes each item as it
  // arrives has a subtle bug: if `src/components` arrives before `src`,
  // the parent lookup `dirs[parentPath]` misses and the child gets pushed
  // to root. Doing one pass to register every directory node, then a second
  // pass to place every item under its parent, is order-independent.
  //
  // Pass 1: register every directory so later placements always find their
  // parent.
  for (const item of items) {
    if (item.kind === "dir") {
      dirs[item.path] = {
        name: item.name,
        path: item.path,
        kind: "directory",
        children: [],
        isExpanded: expandedPaths.has(item.path),
      };
    }
  }

  // Pass 2: place every item under its parent (or root).
  for (const item of items) {
    const node: TreeNode = item.kind === "dir"
      ? dirs[item.path]
      : { name: item.name, path: item.path, kind: "file", children: [], isExpanded: false };

    const parentPath = item.path.includes("/")
      ? item.path.substring(0, item.path.lastIndexOf("/"))
      : "";

    if (parentPath && dirs[parentPath]) {
      dirs[parentPath].children.push(node);
    } else {
      root.push(node);
    }
  }

  const compareNodes = (a: TreeNode, b: TreeNode) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  };
  const sortChildren = (nodes: TreeNode[]) => {
    nodes.sort(compareNodes);
    for (const n of nodes) {
      if (n.children.length > 0) sortChildren(n.children);
    }
  };
  sortChildren(root);

  return root;
}

export function flattenTree(nodes: TreeNode[], expandedPaths: Set<string>, depth = 0, index = 0): FlatNode[] {
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

// Collect every directory path in a (possibly nested) tree. Used by the search
// feature to expand the whole tree so query matches are always visible.
export function collectDirectoryPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const visit = (xs: TreeNode[]) => {
    for (const n of xs) {
      if (n.kind === "directory") {
        out.push(n.path);
        if (n.children.length > 0) visit(n.children);
      }
    }
  };
  visit(nodes);
  return out;
}

// Normalize a string for fuzzy search: lowercase + strip diacritics. Lets
// "ngon ngu" match "ngôn ngữ" and "App" match "app".
export function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// Folders to skip when filtering search results. These are config/dependency
// trees that aren't part of the user's source code and would otherwise
// dominate the result list (especially `.opencode/skills` which is large).
const SEARCH_EXCLUDED_DIRS = new Set(["node_modules", ".opencode", ".git", "dist", "build", ".next", ".turbo", "coverage"]);

export function isInExcludedDir(filePath: string): boolean {
  return filePath.split(/[/\\]/).some((segment) => SEARCH_EXCLUDED_DIRS.has(segment));
}

export function pathMatchesQuery(filePath: string, query: string): boolean {
  if (isInExcludedDir(filePath)) return false;
  const trimmed = query.trim();
  if (!trimmed) return true;
  const normalizedPath = normalizeForSearch(filePath);
  const words = normalizeForSearch(trimmed).split(/\s+/).filter(Boolean);
  return words.every((word) => normalizedPath.includes(word));
}

/**
 * Find a file in the tree whose lowercased path matches `lowerCasedPath`.
 * Returns the path with the workspace's original casing, or `null` if not
 * found. The file IDs in panel-tab-store are derived from a lowercased
 * path, so we need this lookup to display the highlight in the right case.
 */
export function findMatchingTreePath(nodes: TreeNode[], lowerCasedPath: string): string | null {
  const target = lowerCasedPath.toLowerCase();
  const visit = (xs: TreeNode[]): string | null => {
    for (const node of xs) {
      if (node.path.toLowerCase() === target) return node.path;
      if (node.kind === "directory" && node.children.length > 0) {
        const found = visit(node.children);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(nodes);
}
