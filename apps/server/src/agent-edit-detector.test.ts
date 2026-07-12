/**
 * Unit tests for AgentEditDetector. Pure logic, no filesystem.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { AgentEditDetector } from "./agent-edit-detector.js";
import type { ServerConfig } from "./types.js";

const baseConfig: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  token: "t",
  hostToken: "h",
  approval: { mode: "auto", timeoutMs: 1000 },
  corsOrigins: ["*"],
  workspaces: [],
  authorizedRoots: [],
  readOnly: false,
  startedAt: Date.now(),
  tokenSource: "cli",
  hostTokenSource: "cli",
  logFormat: "pretty",
  logRequests: false,
};

describe("AgentEditDetector", () => {
  let detector: AgentEditDetector;
  const now = 1_700_000_000_000;

  beforeEach(() => {
    detector = new AgentEditDetector(baseConfig);
  });

  afterEach(() => {
    detector.stop();
  });

  test("classifies a change as 'agent' when no recent HTTP write", () => {
    expect(detector.classifyChange("ws_1", "src/foo.ts", now)).toBe("agent");
  });

  test("classifies a change as 'http' within the TTL window", () => {
    detector.markHttpWrite("ws_1", "src/foo.ts", now);
    expect(detector.classifyChange("ws_1", "src/foo.ts", now + 1_000)).toBe("http");
  });

  test("classifies as 'agent' after the TTL expires", () => {
    detector.markHttpWrite("ws_1", "src/foo.ts", now);
    // 11s later — outside the 10s TTL.
    expect(detector.classifyChange("ws_1", "src/foo.ts", now + 11_000)).toBe("agent");
  });

  test("consumes the HTTP mark after classifying so it isn't double-counted", () => {
    detector.markHttpWrite("ws_1", "src/foo.ts", now);
    expect(detector.classifyChange("ws_1", "src/foo.ts", now + 500)).toBe("http");
    // Same write, next poll cycle: no mark → "agent". This is what we
    // want: the middleware already snapshotted once, we don't want
    // the poller to keep classifying the same write as "http".
    expect(detector.classifyChange("ws_1", "src/foo.ts", now + 600)).toBe("agent");
  });

  test("scopes HTTP marks per workspace", () => {
    detector.markHttpWrite("ws_1", "src/foo.ts", now);
    // Different workspace: not marked → "agent".
    expect(detector.classifyChange("ws_2", "src/foo.ts", now + 1_000)).toBe("agent");
    expect(detector.classifyChange("ws_1", "src/foo.ts", now + 1_000)).toBe("http");
  });

  test("scopes HTTP marks per file path", () => {
    detector.markHttpWrite("ws_1", "src/foo.ts", now);
    expect(detector.classifyChange("ws_1", "src/bar.ts", now + 1_000)).toBe("agent");
  });

  test("recordLastSeen + getLastSeen", () => {
    expect(detector.getLastSeen("ws_1", "foo.ts")).toBeNull();
    detector.recordLastSeen("ws_1", "foo.ts", { mtimeMs: 100, size: 42 });
    expect(detector.getLastSeen("ws_1", "foo.ts")).toEqual({ mtimeMs: 100, size: 42 });
  });

  test("forget removes a path from lastSeen", () => {
    detector.recordLastSeen("ws_1", "foo.ts", { mtimeMs: 100, size: 42 });
    detector.forget("ws_1", "foo.ts");
    expect(detector.getLastSeen("ws_1", "foo.ts")).toBeNull();
    expect(detector.trackedFiles("ws_1")).toEqual([]);
  });

  test("prune drops expired HTTP marks", () => {
    detector.markHttpWrite("ws_1", "src/foo.ts", now);
    detector.markHttpWrite("ws_1", "src/bar.ts", now + 5_000);
    // 20s later — both should be expired (TTL is 10s).
    detector.prune(now + 20_000);
    expect(detector.classifyChange("ws_1", "src/foo.ts", now + 20_000)).toBe("agent");
    expect(detector.classifyChange("ws_1", "src/bar.ts", now + 20_000)).toBe("agent");
  });

  test("prune keeps fresh HTTP marks", () => {
    detector.markHttpWrite("ws_1", "src/foo.ts", now);
    detector.prune(now + 5_000);
    expect(detector.classifyChange("ws_1", "src/foo.ts", now + 5_000)).toBe("http");
  });
});
