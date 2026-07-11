import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  commandMatchesPackagedSidecar,
  prioritizeWorkspacePaths,
  resolveOpenworkServerConfigPath,
  seedWorkspacePathsForEmbeddedServer,
  selectStickyOpenworkPortWorkspace,
  snapshotEngineState,
} from "./runtime.mjs";

describe("prioritizeWorkspacePaths", () => {
  it("keeps the active runtime workspace first", () => {
    assert.deepEqual(
      prioritizeWorkspacePaths("/workspace/current", ["/workspace/other", "/workspace/current"]),
      ["/workspace/current", "/workspace/other"],
    );
  });

  it("dedupes equivalent paths", () => {
    assert.deepEqual(
      prioritizeWorkspacePaths("/workspace/current/../current", ["/workspace/current"]),
      ["/workspace/current/../current"],
    );
  });
});

describe("seedWorkspacePathsForEmbeddedServer", () => {
  it("uses persisted server config instead of Electron workspace state once config exists", () => {
    assert.deepEqual(
      seedWorkspacePathsForEmbeddedServer(["/workspace/legacy"], true),
      [],
    );
  });

  it("seeds from Electron workspace state before server config exists", () => {
    assert.deepEqual(
      seedWorkspacePathsForEmbeddedServer(["/workspace/first"], false),
      ["/workspace/first"],
    );
  });
});

describe("selectStickyOpenworkPortWorkspace", () => {
  it("uses the requested workspace even when server config owns workspace loading", () => {
    assert.equal(
      selectStickyOpenworkPortWorkspace(["/workspace/current"], []),
      "/workspace/current",
    );
  });

  it("falls back to server workspace paths when no requested path is available", () => {
    assert.equal(
      selectStickyOpenworkPortWorkspace([], ["/workspace/from-server"]),
      "/workspace/from-server",
    );
  });
});

describe("commandMatchesPackagedSidecar", () => {
  it("matches packaged opencode sidecars with platform suffixes", () => {
    assert.equal(
      commandMatchesPackagedSidecar(
        "/Applications/OpenWork.app/Contents/Resources/sidecars/opencode-aarch64-apple-darwin serve --hostname 127.0.0.1 --port 49174 --cors *",
        ["/Applications/OpenWork.app/Contents/Resources/sidecars"],
      ),
      true,
    );
  });

  it("does not match unrelated opencode processes outside sidecar directories", () => {
    assert.equal(
      commandMatchesPackagedSidecar(
        "/usr/local/bin/opencode serve --hostname 127.0.0.1 --port 49174",
        ["/Applications/OpenWork.app/Contents/Resources/sidecars"],
      ),
      false,
    );
  });
});

describe("resolveOpenworkServerConfigPath", () => {
  it("respects explicit server config path", () => {
    assert.equal(
      resolveOpenworkServerConfigPath({ OPENWORK_SERVER_CONFIG: "/tmp/openwork/server.json" }),
      "/tmp/openwork/server.json",
    );
  });

  it("uses XDG config home on Unix", () => {
    if (process.platform === "win32") return;
    assert.equal(
      resolveOpenworkServerConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg" }),
      "/tmp/xdg/openwork/server.json",
    );
  });
});

describe("snapshotEngineState", () => {
  const baseFields = {
    runtime: "direct",
    projectDir: "/Users/trannhan/project/openwork",
    hostname: "127.0.0.1",
    port: 49974,
    opencodeUsername: "user",
    opencodePassword: "pass",
    opencodeBinPath: "/usr/bin/opencode",
    opencodeBinSource: "bundled",
    lastStdout: null,
    lastStderr: null,
    execution: null,
  };

  it("reports running when opencode is managed by the in-process server and baseUrl is known", () => {
    const snapshot = snapshotEngineState({
      ...baseFields,
      child: null,
      childExited: false,
      managedByServer: true,
      baseUrl: "http://127.0.0.1:49974",
    });
    assert.equal(snapshot.running, true);
    assert.equal(snapshot.managedByServer, true);
    assert.equal(snapshot.baseUrl, "http://127.0.0.1:49974");
    assert.equal(snapshot.pid, null);
  });

  it("reports not running when managed by server but baseUrl is missing", () => {
    const snapshot = snapshotEngineState({
      ...baseFields,
      child: null,
      childExited: false,
      managedByServer: true,
      baseUrl: null,
    });
    assert.equal(snapshot.running, false);
    assert.equal(snapshot.managedByServer, true);
  });

  it("falls back to child liveness when not managed by server", () => {
    const liveChild = { pid: 90945, exitCode: null, killed: false };
    const snapshot = snapshotEngineState({
      ...baseFields,
      child: liveChild,
      childExited: false,
      managedByServer: false,
      baseUrl: "http://127.0.0.1:49974",
    });
    assert.equal(snapshot.running, true);
    assert.equal(snapshot.pid, 90945);
    assert.equal(snapshot.managedByServer, false);
  });

  it("reports not running when owned child has exited", () => {
    const deadChild = { pid: 90945, exitCode: 0, killed: false };
    const snapshot = snapshotEngineState({
      ...baseFields,
      child: deadChild,
      childExited: false,
      managedByServer: false,
      baseUrl: "http://127.0.0.1:49974",
    });
    assert.equal(snapshot.running, false);
    assert.equal(snapshot.pid, 90945);
  });

  it("reports not running when childExited has flipped even if child object survives", () => {
    const snapshot = snapshotEngineState({
      ...baseFields,
      child: { pid: 90945, exitCode: null, killed: false },
      childExited: true,
      managedByServer: false,
      baseUrl: "http://127.0.0.1:49974",
    });
    assert.equal(snapshot.running, false);
    assert.equal(snapshot.pid, null);
  });
});
