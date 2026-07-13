import { beforeEach, describe, expect, test } from "bun:test";

import { useReviewStore } from "../src/react-app/domains/session/panel/review-store";

function reset() {
  useReviewStore.setState({
    pendingBySession: {},
    activeInnerTabBySession: {},
    expandedFilesBySession: {},
    pendingMutationIds: new Set<string>(),
    historyStatusFilterBySession: {},
    activeDiffFileBySession: {},
  });
}

// These tests exercise the store via getState()/setState() directly so
// they don't need a React render context. The hook selectors in the
// same file (`useSessionPending` etc.) are tested implicitly by
// component-level integration tests, since calling a React hook
// outside a render throws in React 19.

function pendingFor(sessionId: string) {
  return useReviewStore.getState().pendingBySession[sessionId];
}

function expandedFor(sessionId: string): string[] {
  return useReviewStore.getState().expandedFilesBySession[sessionId] ?? [];
}

function mutationIds(): Set<string> {
  return useReviewStore.getState().pendingMutationIds;
}

function filterFor(sessionId: string) {
  return useReviewStore.getState().historyStatusFilterBySession[sessionId] ?? "all";
}

describe("review store", () => {
  beforeEach(() => {
    reset();
  });

  test("setPendingCount pushes count + latestAt + flips seen when newer arrives", () => {
    const { setPendingCount, markSeen } = useReviewStore.getState();
    setPendingCount("s1", 3, 1000);
    expect(pendingFor("s1")).toEqual({ fileCount: 3, latestAt: 1000, seen: false });
    markSeen("s1");
    expect(pendingFor("s1")?.seen).toBe(true);

    // Newer arrival re-flips seen.
    setPendingCount("s1", 4, 2000);
    expect(pendingFor("s1")).toEqual({ fileCount: 4, latestAt: 2000, seen: false });
  });

  test("setPendingCount with same count + latestAt is a no-op", () => {
    const { setPendingCount } = useReviewStore.getState();
    setPendingCount("s1", 3, 1000);
    const before = useReviewStore.getState();
    setPendingCount("s1", 3, 1000);
    const after = useReviewStore.getState();
    expect(after).toBe(before);
  });

  test("toggleExpanded tracks file paths per session", () => {
    const { toggleExpanded } = useReviewStore.getState();
    toggleExpanded("s1", "a.ts");
    toggleExpanded("s1", "b.ts");
    expect(expandedFor("s1").sort()).toEqual(["a.ts", "b.ts"]);
    toggleExpanded("s1", "a.ts");
    expect(expandedFor("s1")).toEqual(["b.ts"]);
  });

  test("addPendingMutation / removePendingMutation flips per-id state", () => {
    const { addPendingMutation, removePendingMutation } = useReviewStore.getState();
    addPendingMutation("snap-1");
    expect(mutationIds().has("snap-1")).toBe(true);
    expect(mutationIds().has("snap-2")).toBe(false);
    // Adding the same id twice must be a no-op (set dedup, and the
    // store should not allocate a new Set on the second call).
    const before = mutationIds();
    addPendingMutation("snap-1");
    expect(mutationIds()).toBe(before);
    removePendingMutation("snap-1");
    expect(mutationIds().has("snap-1")).toBe(false);
  });

  test("setHistoryStatusFilter is per-session", () => {
    const { setHistoryStatusFilter } = useReviewStore.getState();
    setHistoryStatusFilter("s1", "pending");
    expect(filterFor("s1")).toBe("pending");
    expect(filterFor("s2")).toBe("all");
  });

  test("clearSession removes only the target session", () => {
    const { setPendingCount, setActiveInnerTab, setHistoryStatusFilter, clearSession } =
      useReviewStore.getState();
    setPendingCount("s1", 1, 100);
    setActiveInnerTab("s1", "history");
    setHistoryStatusFilter("s1", "approved");
    setPendingCount("s2", 2, 200);

    clearSession("s1");
    expect(pendingFor("s1")).toBeUndefined();
    expect(filterFor("s1")).toBe("all");
    expect(pendingFor("s2")?.fileCount).toBe(2);
  });

  test("clearSession resets pendingMutationIds when any are in flight", () => {
    const { addPendingMutation, clearSession } = useReviewStore.getState();
    addPendingMutation("snap-x");
    addPendingMutation("snap-y");
    expect(mutationIds().size).toBe(2);
    clearSession("s1");
    expect(mutationIds().size).toBe(0);
  });
});
