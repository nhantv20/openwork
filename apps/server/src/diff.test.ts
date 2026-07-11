import { describe, expect, test } from "bun:test";
import { MAX_DIFF_INPUT_BYTES, PayloadTooLargeError, unifiedDiff } from "./diff.js";

describe("unifiedDiff", () => {
  test("returns empty string for identical inputs", () => {
    expect(unifiedDiff("hello", "hello")).toBe("");
  });

  test("produces unified diff for added lines", () => {
    const diff = unifiedDiff("a\nb\n", "a\nb\nc\n", { fileName: "x.ts" });
    expect(diff).toContain("--- x.ts");
    expect(diff).toContain("+++ x.ts");
    expect(diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(diff).toContain("+c");
  });

  test("produces unified diff for removed lines", () => {
    const diff = unifiedDiff("a\nb\nc\n", "a\nc\n", { fileName: "x.ts" });
    expect(diff).toContain("-b");
    expect(diff).not.toContain("+b");
    expect(diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  test("produces unified diff for multi-hunk changes", () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n") + "\n";
    const newText = oldText.replace("line5", "line5-changed").replace("line15", "line15-changed");
    const diff = unifiedDiff(oldText, newText, { fileName: "x.ts" });
    // Expect two @@ hunks.
    const hunks = diff.match(/^@@ /gm);
    expect(hunks?.length).toBe(2);
  });

  test("throws PayloadTooLargeError when old text exceeds 1MB", () => {
    const big = "x".repeat(MAX_DIFF_INPUT_BYTES + 1);
    expect(() => unifiedDiff(big, "y")).toThrow(PayloadTooLargeError);
  });

  test("throws PayloadTooLargeError when new text exceeds 1MB", () => {
    const big = "x".repeat(MAX_DIFF_INPUT_BYTES + 1);
    expect(() => unifiedDiff("y", big)).toThrow(PayloadTooLargeError);
  });

  test("accepts content exactly at the 1MB cap", () => {
    const exact = "x".repeat(MAX_DIFF_INPUT_BYTES);
    const diff = unifiedDiff(exact, exact);
    expect(diff).toBe("");
  });

  test("uses provided fileName + labels in the header", () => {
    const diff = unifiedDiff("a", "b", {
      fileName: "src/foo.ts",
      oldLabel: "v1",
      newLabel: "v2",
    });
    expect(diff).toContain("--- src/foo.ts");
    expect(diff).toContain("+++ src/foo.ts");
    expect(diff).toContain("v1");
    expect(diff).toContain("v2");
  });
});
