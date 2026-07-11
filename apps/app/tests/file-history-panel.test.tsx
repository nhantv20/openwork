/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";

describe("FileHistoryPanel + useFileHistory module shape (slice 6.4)", () => {
  test("hook is exported and has expected shape", async () => {
    const mod = await import("../src/react-app/domains/session/artifacts/hooks/use-file-history");
    expect(typeof mod.useFileHistory).toBe("function");
  });

  test("panel module imports cleanly without throwing", async () => {
    const mod = await import("../src/react-app/domains/session/artifacts/file-history-panel");
    expect(typeof mod.FileHistoryPanel).toBe("function");
  });
});
