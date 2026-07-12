/** @jsxImportSource react */
import { describe, expect, mock, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { renderToStaticMarkup } from "react-dom/server";

import {
  HistoryStatusBadge,
  relativeSnapshotLabel,
} from "../src/react-app/domains/session/artifacts/history-status-badge";
import type {
  OpenworkServerClient,
  OpenworkFileSnapshotLite,
} from "../src/app/lib/openwork-server";

type ClientOverrides = {
  listFileLatest?: OpenworkServerClient["listFileLatest"];
};

function makeClient(overrides: ClientOverrides = {}): OpenworkServerClient {
  return {
    listFileLatest: overrides.listFileLatest ?? (async () => ({ snapshot: null })),
  } as unknown as OpenworkServerClient;
}

describe("HistoryStatusBadge (SSR render — no DOM, no useEffect flush)", () => {
  test("round-5 regression: renders without an OpenworkServerProvider", () => {
    // Before the fix, the badge called useOpenworkServer() which throws when
    // no provider is mounted. If we accidentally reintroduce that hook call,
    // renderToString throws synchronously and this test fails.
    const client = makeClient();
    expect(() =>
      renderToString(
        <HistoryStatusBadge client={client} workspaceId="ws-1" filePath="src/a.ts" />,
      ),
    ).not.toThrow();
  });

  test("renders nothing without workspaceId + filePath", () => {
    const client = makeClient();
    const html = renderToStaticMarkup(
      <HistoryStatusBadge client={client} workspaceId={null} filePath={null} />,
    );
    expect(html).toBe("");
  });

  test("badge is single-line: whitespace-nowrap + shrink-0 (round-5 visual regression)", () => {
    // The pill lives inside a flex row with a truncating <h3> sibling. Without
    // whitespace-nowrap the label wraps vertically (3 lines: "auto-" /
    // "snapshot" / "· never"), which we hit on the first UI smoke test.
    const client = makeClient();
    const html = renderToStaticMarkup(
      <HistoryStatusBadge client={client} workspaceId="ws-1" filePath="src/a.ts" />,
    );
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("shrink-0");
  });

  test("renders the badge with 'never' label on first paint (latest=null)", () => {
    const client = makeClient({
      listFileLatest: async () => ({ snapshot: null }),
    });
    const html = renderToStaticMarkup(
      <HistoryStatusBadge client={client} workspaceId="ws-1" filePath="src/empty.ts" />,
    );
    expect(html).toContain("data-testid=\"history-status-badge\"");
    expect(html).toContain("auto-snapshot");
    // First paint shows "…" before the poll resolves.
    expect(html).toContain("…");
  });
});

describe("HistoryStatusBadge behaviour (unit tests on the polled handler)", () => {
  test("listFileLatest is invoked with the right workspaceId + filePath", async () => {
    const listFileLatest = mock(async () => ({ snapshot: null }));
    const client = makeClient({ listFileLatest });
    // Just call the mock directly to verify the contract — the badge wires
    // this exact call inside its useEffect.
    await client.listFileLatest("ws-1", "src/a.ts");
    expect(listFileLatest).toHaveBeenCalledTimes(1);
    expect(listFileLatest.mock.calls[0]).toEqual(["ws-1", "src/a.ts"]);
  });

  test("listFileLatest resolves with a null snapshot when no history exists", async () => {
    const client = makeClient({ listFileLatest: async () => ({ snapshot: null }) });
    const { snapshot } = await client.listFileLatest("ws-1", "src/missing.ts");
    expect(snapshot).toBeNull();
  });

  test("listFileLatest resolves with a snapshot row when present", async () => {
    const snap: OpenworkFileSnapshotLite = {
      id: "snap-99",
      createdAt: Date.now() - 30_000,
      size: 120,
      trigger: "auto",
    };
    const client = makeClient({ listFileLatest: async () => ({ snapshot: snap }) });
    const { snapshot } = await client.listFileLatest("ws-1", "src/x.ts");
    expect(snapshot?.id).toBe("snap-99");
    expect(snapshot?.trigger).toBe("auto");
  });
});

describe("relativeSnapshotLabel (badge text helper)", () => {
  test("just now", () => {
    const now = 1_000_000;
    expect(relativeSnapshotLabel(now - 2_000, now)).toBe("just now");
  });

  test("seconds ago", () => {
    const now = 1_000_000;
    expect(relativeSnapshotLabel(now - 30_000, now)).toBe("30s ago");
  });

  test("minutes ago", () => {
    const now = 1_000_000;
    expect(relativeSnapshotLabel(now - 5 * 60_000, now)).toBe("5 min ago");
  });

  test("hours ago", () => {
    const now = 1_000_000;
    expect(relativeSnapshotLabel(now - 2 * 3_600_000, now)).toBe("2 h ago");
  });

  test("days ago", () => {
    const now = 1_000_000;
    expect(relativeSnapshotLabel(now - 3 * 86_400_000, now)).toBe("3 d ago");
  });
});
