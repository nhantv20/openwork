/**
 * Unit tests for the file explorer pure helpers.
 *
 * These cover every function exported from `./file-explorer-helpers`. They
 * guard against regressions in tree sorting, expand/collapse flattening,
 * search behaviour (case + diacritic + multi-word AND + excluded dirs),
 * and case-insensitive path lookup used by the cross-tab selection sync.
 */
import { describe, expect, test } from "bun:test";

import {
  buildTree,
  collectDirectoryPaths,
  findMatchingTreePath,
  flattenTree,
  isInExcludedDir,
  normalizeForSearch,
  pathMatchesQuery,
} from "./file-explorer-helpers";

describe("buildTree", () => {
  test("sorts directories before files then alphabetically within each kind", () => {
    const items = [
      { name: "zeta.md", path: "zeta.md", kind: "file" as const },
      { name: "alpha", path: "alpha", kind: "dir" as const },
      { name: "beta.md", path: "beta.md", kind: "file" as const },
      { name: "Alpha", path: "Alpha", kind: "dir" as const },
    ];
    const tree = buildTree(items, new Set());
    // Default localeCompare puts lowercase before uppercase, so within dirs:
    // "alpha" < "Alpha". Within files: "beta.md" < "zeta.md".
    expect(tree.map((n) => n.name)).toEqual(["alpha", "Alpha", "beta.md", "zeta.md"]);
  });

  test("nests children under their parent directory", () => {
    const items = [
      { name: "src", path: "src", kind: "dir" as const },
      { name: "App.tsx", path: "src/App.tsx", kind: "file" as const },
      { name: "components", path: "src/components", kind: "dir" as const },
      { name: "Button.tsx", path: "src/components/Button.tsx", kind: "file" as const },
    ];
    const tree = buildTree(items, new Set());
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("src");
    expect(tree[0].children.map((c) => c.name)).toEqual(["components", "App.tsx"]);
    expect(tree[0].children[0].children.map((c) => c.name)).toEqual(["Button.tsx"]);
  });

  test("places a child under its parent even when the child is alphabetically before the parent", () => {
    // Regression test for the "global sort" bug where `src/components`
    // (alphabetical "c") would be processed before `src` ("s"), so the
    // parent lookup missed and the child got pushed to root.
    const items = [
      { name: "components", path: "src/components", kind: "dir" as const },
      { name: "src", path: "src", kind: "dir" as const },
      { name: "Button.tsx", path: "src/components/Button.tsx", kind: "file" as const },
    ];
    const tree = buildTree(items, new Set());
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("src");
    expect(tree[0].children[0].name).toBe("components");
    expect(tree[0].children[0].children[0].name).toBe("Button.tsx");
  });

  test("marks isExpanded for directories in the expandedPaths set", () => {
    const items = [
      { name: "src", path: "src", kind: "dir" as const },
      { name: "docs", path: "docs", kind: "dir" as const },
    ];
    const tree = buildTree(items, new Set(["src"]));
    const src = tree.find((n) => n.path === "src")!;
    const docs = tree.find((n) => n.path === "docs")!;
    expect(src.isExpanded).toBe(true);
    expect(docs.isExpanded).toBe(false);
  });

  test("files never have isExpanded set even when their path is in expandedPaths", () => {
    const items = [{ name: "README.md", path: "README.md", kind: "file" as const }];
    const tree = buildTree(items, new Set(["README.md"]));
    expect(tree[0].isExpanded).toBe(false);
    expect(tree[0].children).toEqual([]);
  });
});

describe("flattenTree", () => {
  function fixture() {
    return buildTree(
      [
        { name: "src", path: "src", kind: "dir" },
        { name: "App.tsx", path: "src/App.tsx", kind: "file" },
        { name: "components", path: "src/components", kind: "dir" },
        { name: "Button.tsx", path: "src/components/Button.tsx", kind: "file" },
        { name: "README.md", path: "README.md", kind: "file" },
      ],
      new Set(["src"]),
    );
  }

  test("returns contiguous, monotonically increasing indices", () => {
    // With only "src" expanded, components is collapsed (children not shown),
    // so the flat list is: src, components, App.tsx, README.md → 4 items.
    const flat = flattenTree(fixture(), new Set(["src"]));
    expect(flat.map((n) => n.index)).toEqual([0, 1, 2, 3]);
  });

  test("increments depth on every directory expansion", () => {
    const flat = flattenTree(fixture(), new Set(["src", "src/components"]));
    expect(flat.map((n) => ({ path: n.path, depth: n.depth }))).toEqual([
      { path: "src", depth: 0 },
      { path: "src/components", depth: 1 },
      { path: "src/components/Button.tsx", depth: 2 },
      { path: "src/App.tsx", depth: 1 },
      { path: "README.md", depth: 0 },
    ]);
  });

  test("omits children of collapsed directories", () => {
    const flat = flattenTree(fixture(), new Set());
    expect(flat.map((n) => n.path)).toEqual(["src", "README.md"]);
  });

  test("reports hasChildren only for directories with at least one loaded child", () => {
    const tree = buildTree(
      [
        { name: "empty", path: "empty", kind: "dir" },
        { name: "nonempty", path: "nonempty", kind: "dir" },
        { name: "x.ts", path: "nonempty/x.ts", kind: "file" },
      ],
      new Set(),
    );
    const flat = flattenTree(tree, new Set());
    const empty = flat.find((n) => n.path === "empty")!;
    const nonempty = flat.find((n) => n.path === "nonempty")!;
    expect(empty.hasChildren).toBe(false);
    expect(nonempty.hasChildren).toBe(true);
  });
});

describe("collectDirectoryPaths", () => {
  test("returns [] for an empty tree", () => {
    expect(collectDirectoryPaths([])).toEqual([]);
  });

  test("returns only paths of directory nodes, at all depths", () => {
    const tree = buildTree(
      [
        { name: "components", path: "src/components", kind: "dir" },
        { name: "src", path: "src", kind: "dir" },
        { name: "Button.tsx", path: "src/components/Button.tsx", kind: "file" },
      ],
      new Set(["src", "src/components"]),
    );
    expect(collectDirectoryPaths(tree)).toEqual(["src", "src/components"]);
  });

  test("walks deeply nested trees", () => {
    const tree = buildTree(
      [
        { name: "a", path: "a", kind: "dir" },
        { name: "b", path: "a/b", kind: "dir" },
        { name: "c", path: "a/b/c", kind: "dir" },
        { name: "d", path: "a/b/c/d", kind: "dir" },
      ],
      new Set(["a", "a/b", "a/b/c", "a/b/c/d"]),
    );
    expect(collectDirectoryPaths(tree)).toEqual(["a", "a/b", "a/b/c", "a/b/c/d"]);
  });
});

describe("normalizeForSearch", () => {
  test("lowercases ASCII", () => {
    expect(normalizeForSearch("App.tsx")).toBe("app.tsx");
  });

  test("strips Vietnamese diacritics", () => {
    expect(normalizeForSearch("ngôn ngữ")).toBe("ngon ngu");
    expect(normalizeForSearch("Tiếng Việt")).toBe("tieng viet");
  });

  test("preserves non-letter characters and ASCII punctuation", () => {
    expect(normalizeForSearch("User-Profile.tsx")).toBe("user-profile.tsx");
    expect(normalizeForSearch("v2.alpha_3")).toBe("v2.alpha_3");
  });
});

describe("isInExcludedDir", () => {
  test("matches node_modules at any depth", () => {
    expect(isInExcludedDir("node_modules")).toBe(true);
    expect(isInExcludedDir("node_modules/lodash/index.js")).toBe(true);
    expect(isInExcludedDir("packages/web/node_modules/foo")).toBe(true);
  });

  test("matches other excluded folders", () => {
    expect(isInExcludedDir(".git/HEAD")).toBe(true);
    expect(isInExcludedDir("dist/bundle.js")).toBe(true);
    expect(isInExcludedDir(".next/cache/data.json")).toBe(true);
    expect(isInExcludedDir(".opencode/skills/index.md")).toBe(true);
  });

  test("does NOT match similarly named folders", () => {
    expect(isInExcludedDir("my-node_modules")).toBe(false);
    expect(isInExcludedDir("not-a-git")).toBe(false);
    expect(isInExcludedDir("build-tools")).toBe(false);
  });

  test("handles Windows-style backslash separators", () => {
    expect(isInExcludedDir("node_modules\\lodash\\index.js")).toBe(true);
    expect(isInExcludedDir("dist\\bundle.js")).toBe(true);
  });
});

describe("pathMatchesQuery", () => {
  test("empty/whitespace query matches everything except excluded dirs", () => {
    expect(pathMatchesQuery("src/App.tsx", "")).toBe(true);
    expect(pathMatchesQuery("src/App.tsx", "   ")).toBe(true);
    expect(pathMatchesQuery("node_modules/foo/index.js", "")).toBe(false);
  });

  test("exact substring match (case-insensitive)", () => {
    expect(pathMatchesQuery("src/App.tsx", "app")).toBe(true);
    expect(pathMatchesQuery("src/App.tsx", "APP")).toBe(true);
    expect(pathMatchesQuery("src/App.tsx", "ts")).toBe(true);
  });

  test("diacritic-insensitive match", () => {
    expect(pathMatchesQuery("src/ngôn-ngữ.ts", "ngon ngu")).toBe(true);
    // Punctuation is preserved — dashes stay in place. Users searching for
    // "tai lieu" (with a space) get the right hit; searching for the joined
    // form requires the literal dash too.
    expect(pathMatchesQuery("src/tài-liệu/README.md", "tai lieu")).toBe(true);
  });

  test("multi-word AND: every word must appear somewhere in the path", () => {
    expect(pathMatchesQuery("src/components/Button.tsx", "src button")).toBe(true);
    expect(pathMatchesQuery("src/components/Button.tsx", "button missing")).toBe(false);
    expect(pathMatchesQuery("src/components/Button.tsx", "button button")).toBe(true);
  });

  test("filters out excluded directories regardless of query", () => {
    expect(pathMatchesQuery("node_modules/lodash/index.js", "lodash")).toBe(false);
    expect(pathMatchesQuery("dist/bundle.js", "bundle")).toBe(false);
  });
});

describe("findMatchingTreePath", () => {
  function fixture() {
    return buildTree(
      [
        { name: "src", path: "src", kind: "dir" },
        { name: "App.tsx", path: "src/App.tsx", kind: "file" },
        { name: "components", path: "src/Components", kind: "dir" },
        { name: "Button.tsx", path: "src/Components/Button.tsx", kind: "file" },
      ],
      new Set(["src", "src/Components"]),
    );
  }

  test("returns exact-cased path when case matches", () => {
    expect(findMatchingTreePath(fixture(), "src/App.tsx")).toBe("src/App.tsx");
  });

  test("finds a path case-insensitively and returns the tree's original casing", () => {
    expect(findMatchingTreePath(fixture(), "src/components/button.tsx")).toBe(
      "src/Components/Button.tsx",
    );
  });

  test("returns null when path is not in the tree", () => {
    expect(findMatchingTreePath(fixture(), "src/missing.tsx")).toBeNull();
    expect(findMatchingTreePath(fixture(), "totally/unrelated.tsx")).toBeNull();
  });

  test("walks deeply nested directories to find the file", () => {
    const tree = buildTree(
      [
        { name: "a", path: "a", kind: "dir" },
        { name: "b", path: "a/b", kind: "dir" },
        { name: "c", path: "a/b/c", kind: "dir" },
        { name: "deep.tsx", path: "a/b/c/deep.tsx", kind: "file" },
      ],
      new Set(["a", "a/b", "a/b/c"]),
    );
    expect(findMatchingTreePath(tree, "A/B/C/Deep.tsx")).toBe("a/b/c/deep.tsx");
  });
});
