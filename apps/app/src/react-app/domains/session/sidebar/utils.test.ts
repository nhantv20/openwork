/**
 * Unit tests for sidebar session ordering. These lock the "no recency
 * reshuffle" behaviour introduced in
 * docs/plan-sidebar-session-order-stability.md — the sidebar must keep the
 * server-returned order for sessions that the user hasn't pinned or
 * explicitly dragged into a custom order.
 */
import { describe, expect, test } from "bun:test";

import type { WorkspaceSessionGroup } from "../../../../app/types";
import {
  buildSessionTreeState,
  orderRootSessions,
  sortSessionsByRecency,
} from "./utils";

type SessionListItem = WorkspaceSessionGroup["sessions"][number];

const makeSession = (id: string, opts: { updated?: number; parentID?: string | null } = {}): SessionListItem =>
  ({
    id,
    title: id,
    parentID: opts.parentID ?? null,
    time: {
      created: opts.updated ?? 0,
      updated: opts.updated ?? 0,
    },
  }) as unknown as SessionListItem;

describe("orderRootSessions", () => {
  test("preserves input order when there are no pinned ids and no manual order", () => {
    const a = makeSession("a", { updated: 100 });
    const b = makeSession("b", { updated: 200 });
    const c = makeSession("c", { updated: 50 });

    const result = orderRootSessions([a, b, c], new Set(), []);

    expect(result.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  test("keeps recency-driven order out of the picture (the regression we are fixing)", () => {
    // The recency order would be b, a, c. The "fixed" behaviour preserves the
    // input order: a, b, c. If this test starts failing, somebody re-added
    // sortSessionsByRecency into the fallback path.
    const a = makeSession("a", { updated: 100 });
    const b = makeSession("b", { updated: 200 });
    const c = makeSession("c", { updated: 50 });

    const result = orderRootSessions([a, b, c], new Set(), []);
    const recencyOrder = sortSessionsByRecency([a, b, c]).map((s) => s.id);
    const resultIds = result.map((s) => s.id);

    // Sanity: the fixture actually has a non-trivial recency order.
    expect(recencyOrder).toEqual(["b", "a", "c"]);
    // The order we returned must equal the input order, NOT the recency order.
    expect(resultIds).toEqual(["a", "b", "c"]);
  });

  test("floats pinned sessions to the top, preserving their relative order", () => {
    const a = makeSession("a", { updated: 100 });
    const b = makeSession("b", { updated: 200 });
    const c = makeSession("c", { updated: 50 });
    const d = makeSession("d", { updated: 300 });

    // Pin b and d. Expect [b, d, a, c]: the pinned partition walks the
    // input order (a, b, c, d), so b comes before d. a and c stay in input
    // order in the unpinned tail.
    const result = orderRootSessions([a, b, c, d], new Set(["b", "d"]), []);

    expect(result.map((s) => s.id)).toEqual(["b", "d", "a", "c"]);
  });

  test("applies manual order first, then fills with input order, then pins to top", () => {
    const a = makeSession("a", { updated: 100 });
    const b = makeSession("b", { updated: 200 });
    const c = makeSession("c", { updated: 50 });
    const d = makeSession("d", { updated: 300 });

    // User dragged c to the front of unpinned. d is pinned.
    const result = orderRootSessions([a, b, c, d], new Set(["d"]), ["c", "a"]);

    // Pinned partition (d) first, then manual [c, a], then input tail (b).
    expect(result.map((s) => s.id)).toEqual(["d", "c", "a", "b"]);
  });

  test("ignores manual order ids that no longer exist", () => {
    const a = makeSession("a", { updated: 100 });
    const b = makeSession("b", { updated: 200 });

    const result = orderRootSessions([a, b], new Set(), ["ghost", "a"]);

    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("handles empty inputs", () => {
    expect(orderRootSessions([], new Set(), [])).toEqual([]);
    expect(orderRootSessions([], new Set(["a"]), ["a"])).toEqual([]);
  });
});

describe("buildSessionTreeState", () => {
  test("keeps child sessions in the order the server returned them (no recency sort)", () => {
    // Parent p has three children. The recency order is c2, c1, c3 but the
    // input order is c1, c2, c3. We expect the input order — this is the
    // sub-session equivalent of the root-order fix.
    const p = makeSession("p", { updated: 100 });
    const c1 = makeSession("c1", { updated: 100, parentID: "p" });
    const c2 = makeSession("c2", { updated: 500, parentID: "p" });
    const c3 = makeSession("c3", { updated: 50, parentID: "p" });

    const tree = buildSessionTreeState([p, c1, c2, c3], undefined);
    const children = tree.childrenByParent.get("p") ?? [];

    expect(children.map((s) => s.id)).toEqual(["c1", "c2", "c3"]);
  });

  test("excludes archived sessions from the active tree", () => {
    const p = makeSession("p", { updated: 100 });
    const c1 = makeSession("c1", { updated: 100, parentID: "p" });
    const archived = {
      ...makeSession("archived", { updated: 999, parentID: "p" }),
      time: { created: 999, updated: 999, archived: 1 },
    } as unknown as SessionListItem;

    const tree = buildSessionTreeState([p, c1, archived], undefined);
    const children = tree.childrenByParent.get("p") ?? [];

    expect(children.map((s) => s.id)).toEqual(["c1"]);
  });
});
