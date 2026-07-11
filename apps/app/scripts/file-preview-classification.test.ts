import { describe, expect, it } from "bun:test";

import {
  classifyOpenTarget,
  isCollectibleArtifactTarget,
  type OpenTarget,
} from "../src/react-app/domains/session/artifacts/open-target";

function target(value: string, preview: ReturnType<typeof classifyOpenTarget>): OpenTarget {
  return {
    id: `file:${value}`,
    kind: "file",
    value,
    name: value.split("/").pop() ?? value,
    preview,
    confidence: 90,
    reason: "test",
    exists: true,
  };
}

describe("file preview classification", () => {
  describe("slides / document preview surfaces", () => {
    it.each([
      ["deck.pptx", "slides"],
      ["old.ppt", "slides"],
      ["pitch.pptm", "slides"],
      ["template.potx", "slides"],
      ["libre.odp", "slides"],
      ["keynote.key", "slides"],
      ["report.docx", "document"],
      ["legacy.doc", "document"],
      ["writer.odt", "document"],
      ["readme.rtf", "document"],
      ["notes.pages", "document"],
    ])("classifies %s as %s", (filename, expected) => {
      expect(classifyOpenTarget(filename, "file")).toBe(expected);
    });
  });

  describe("rich media coverage", () => {
    it.each([
      ["hero.png", "image"],
      ["hero.jpg", "image"],
      ["vector.svg", "image"],
      ["anim.webp", "image"],
      ["clip.mp4", "video"],
      ["clip.mov", "video"],
      ["sound.mp3", "audio"],
      ["sound.wav", "audio"],
      ["sound.flac", "audio"],
      ["report.pdf", "pdf"],
    ])("classifies %s as %s", (filename, expected) => {
      expect(classifyOpenTarget(filename, "file")).toBe(expected);
    });
  });

  describe("code / diff fallback", () => {
    it.each([
      ["app.tsx"],
      ["script.py"],
      ["main.go"],
      ["lib.rs"],
      ["Cargo.toml"],
      [".env"],
      ["schema.json"],
      ["patch.diff"],
      ["fix.patch"],
    ])("treats %s as text preview", (filename) => {
      expect(classifyOpenTarget(filename, "file")).toBe("text");
    });

    it("routes URLs to browser preview regardless of extension", () => {
      expect(classifyOpenTarget("https://example.com/foo.pptx", "url")).toBe("browser");
    });

    it("falls back to external for unknown binary extensions", () => {
      expect(classifyOpenTarget("archive.zip", "file")).toBe("external");
      expect(classifyOpenTarget("blob.bin", "file")).toBe("external");
    });
  });
});

describe("isCollectibleArtifactTarget", () => {
  it("accepts markdown / sheet / slides / document / image / video / audio / pdf / html previews", () => {
    for (const preview of ["markdown", "sheet", "slides", "document", "image", "video", "audio", "pdf", "html"] as const) {
      expect(isCollectibleArtifactTarget(target("foo", preview))).toBe(true);
    }
  });

  it("accepts text preview for code files, scripts, and plain text", () => {
    for (const preview of ["text"] as const) {
      expect(isCollectibleArtifactTarget(target("foo", preview))).toBe(true);
    }
    for (const value of ["config.json", "app.py", "main.ts", "schema.yaml", ".env", "data.csv"]) {
      const t = { ...target(value, classifyOpenTarget(value, "file")), exists: true };
      expect(isCollectibleArtifactTarget(t)).toBe(true);
    }
  });

  it("rejects external previews (binary files we have no viewer for)", () => {
    expect(isCollectibleArtifactTarget(target("archive.zip", "external"))).toBe(false);
    expect(isCollectibleArtifactTarget(target("blob.bin", "external"))).toBe(false);
  });

  it("rejects missing files even when the extension is supported", () => {
    const t = target("missing.json", "text");
    expect(isCollectibleArtifactTarget({ ...t, exists: false })).toBe(false);
  });

  it("rejects URL targets — they belong to the browser panel", () => {
    const url = { ...target("https://example.com/foo", "browser"), kind: "url" as const };
    expect(isCollectibleArtifactTarget(url)).toBe(false);
  });
});
