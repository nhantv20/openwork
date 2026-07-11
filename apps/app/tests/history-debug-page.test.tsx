/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HistoryDebugPage } from "../src/dev/history-debug";

function renderPanel() {
  return renderToStaticMarkup(React.createElement(HistoryDebugPage));
}

describe("HistoryDebugPage (SSR smoke)", () => {
  test("renders nothing in non-dev (bun test) builds — guards against prod leak", () => {
    // Bun test runs outside Vite, so `import.meta.env.DEV` is falsy.
    // The component MUST return null in that case so a misconfigured prod
    // build can never accidentally surface the dev panel.
    const html = renderPanel();
    expect(html).toBe("");
  });
});
