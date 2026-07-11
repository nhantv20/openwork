import { describe, expect, it } from "bun:test";

import { DiffViewer } from "../src/react-app/domains/session/artifacts/viewers/diff-viewer";
import { SlidesViewer } from "../src/react-app/domains/session/artifacts/viewers/slides-viewer";
import { DocumentViewer } from "../src/react-app/domains/session/artifacts/viewers/document-viewer";
import { ArtifactIcon } from "../src/react-app/domains/session/artifacts/artifact-icon";

describe("preview viewer surface area", () => {
  it("exposes the unified set of viewers", () => {
    expect(typeof DiffViewer).toBe("function");
    expect(typeof SlidesViewer).toBe("function");
    expect(typeof DocumentViewer).toBe("function");
    expect(typeof ArtifactIcon).toBe("function");
  });

  it("renders an icon for every supported preview type", () => {
    const types = [
      "browser",
      "markdown",
      "sheet",
      "slides",
      "document",
      "image",
      "video",
      "audio",
      "pdf",
      "html",
      "text",
      "external",
    ] as const;
    for (const type of types) {
      const node = ArtifactIcon({ type });
      expect(node).toBeTruthy();
    }
  });
});
