/**
 * Persisted state for the file explorer panel.
 *
 * Two pieces of UI state need to survive navigation away from the panel and
 * the surrounding remounts:
 *   - which directories the user has expanded or collapsed in the file tree,
 *   - which file the user had selected (highlighted in the tree).
 *
 * Both are keyed by `workspaceId` so opening a different workspace in the same
 * session doesn't bleed state across projects. The store is persisted to
 * localStorage so they survive an app restart.
 *
 * The search snapshot (`savedExpandedBeforeSearch`) is intentionally NOT
 * persisted — it is only a transient undo buffer used while a search query is
 * active.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type WorkspaceExplorerState = {
  expandedPaths: string[];
  selectedPath: string | null;
};

type FileExplorerState = {
  byWorkspace: Record<string, WorkspaceExplorerState>;
};

type FileExplorerActions = {
  toggleExpanded: (workspaceId: string, path: string) => void;
  expand: (workspaceId: string, paths: string[]) => void;
  collapse: (workspaceId: string, path: string) => void;
  setSelected: (workspaceId: string, path: string | null) => void;
  /**
   * Expand every directory that contains the given file path so the file
   * becomes visible in the tree. Useful when the user opens a file from
   * somewhere other than the tree (e.g. a chat mention) and the tree is
   * currently collapsed.
   *
   * Returns the list of directory paths that were expanded, so callers can
   * kick off a lazy-load for each if they need to render their children.
   */
  expandAncestors: (workspaceId: string, filePath: string) => string[];
  clearWorkspace: (workspaceId: string) => void;
};

export type FileExplorerStore = FileExplorerState & FileExplorerActions;

const EMPTY_WORKSPACE: WorkspaceExplorerState = {
  expandedPaths: [],
  selectedPath: null,
};

export const FILE_EXPLORER_STORE_KEY = "openwork.file-explorer:v1";

export const useFileExplorerStore = create<FileExplorerStore>()(
  persist(
    (set) => ({
      byWorkspace: {},

      toggleExpanded: (workspaceId, path) =>
        set((state) => {
          const ws = state.byWorkspace[workspaceId] ?? EMPTY_WORKSPACE;
          const expanded = new Set(ws.expandedPaths);
          if (expanded.has(path)) {
            expanded.delete(path);
          } else {
            expanded.add(path);
          }
          return {
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: { ...ws, expandedPaths: [...expanded] },
            },
          };
        }),

      expand: (workspaceId, paths) =>
        set((state) => {
          if (paths.length === 0) return state;
          const ws = state.byWorkspace[workspaceId] ?? EMPTY_WORKSPACE;
          const expanded = new Set(ws.expandedPaths);
          for (const p of paths) expanded.add(p);
          return {
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: { ...ws, expandedPaths: [...expanded] },
            },
          };
        }),

      collapse: (workspaceId, path) =>
        set((state) => {
          const ws = state.byWorkspace[workspaceId] ?? EMPTY_WORKSPACE;
          if (!ws.expandedPaths.includes(path)) return state;
          return {
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: {
                ...ws,
                expandedPaths: ws.expandedPaths.filter((p) => p !== path),
              },
            },
          };
        }),

      setSelected: (workspaceId, path) =>
        set((state) => {
          const ws = state.byWorkspace[workspaceId] ?? EMPTY_WORKSPACE;
          if (ws.selectedPath === path) return state;
          return {
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: { ...ws, selectedPath: path },
            },
          };
        }),

      expandAncestors: (workspaceId, filePath) => {
        // Compute the chain of ancestor directories (root-first). The file
        // path is relative to the workspace root; "src/foo/bar.ts" expands
        // to ["src", "src/foo"].
        const segments = filePath.split("/").filter(Boolean);
        if (segments.length <= 1) return [];
        const ancestors: string[] = [];
        for (let i = 0; i < segments.length - 1; i++) {
          ancestors.push(segments.slice(0, i + 1).join("/"));
        }
        // Only expand ancestors that aren't already expanded. Persist any new
        // ones, then return the full list so the caller can fetch their
        // children lazily.
        const result: string[] = [];
        set((state) => {
          const ws = state.byWorkspace[workspaceId] ?? EMPTY_WORKSPACE;
          const expanded = new Set(ws.expandedPaths);
          const newlyExpanded: string[] = [];
          for (const dir of ancestors) {
            if (!expanded.has(dir)) {
              expanded.add(dir);
              newlyExpanded.push(dir);
            }
          }
          if (newlyExpanded.length === 0) {
            result.push(...ancestors);
            return state;
          }
          result.push(...ancestors);
          return {
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: { ...ws, expandedPaths: [...expanded] },
            },
          };
        });
        return result;
      },

      clearWorkspace: (workspaceId) =>
        set((state) => {
          if (!state.byWorkspace[workspaceId]) return state;
          const { [workspaceId]: _drop, ...rest } = state.byWorkspace;
          return { byWorkspace: rest };
        }),
    }),
    {
      name: FILE_EXPLORER_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

/**
 * React hook returning a memoised Set view of the expanded paths for a
 * workspace. Use this in render code (cheaper to re-render only when the
 * underlying array changes); use `useFileExplorerStore.getState()` directly
 * for one-off reads inside event handlers.
 */
export function useWorkspaceExpandedPaths(workspaceId: string | null | undefined): {
  expanded: Set<string>;
  selectedPath: string | null;
  has: (path: string) => boolean;
} {
  const expanded = useFileExplorerStore((state) => {
    if (!workspaceId) return EMPTY_WORKSPACE.expandedPaths;
    return state.byWorkspace[workspaceId]?.expandedPaths ?? EMPTY_WORKSPACE.expandedPaths;
  });
  const selectedPath = useFileExplorerStore((state) => {
    if (!workspaceId) return null;
    return state.byWorkspace[workspaceId]?.selectedPath ?? null;
  });
  // Re-create the Set only when the underlying array changes.
  // `useMemo` here would be fine but a small inline `useMemo` keeps the hook
  // surface tight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return {
    expanded: new Set(expanded),
    selectedPath,
    has: (path: string) => expanded.includes(path),
  };
}
