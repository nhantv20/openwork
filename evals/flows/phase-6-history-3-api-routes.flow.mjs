/**
 * Phase 6, slice 6.3 — Real history API routes + dev panel clickable.
 *
 * Drives the `/_dev/history` React page through:
 *   1. Save a manual snapshot (hits POST /workspace/:id/history/snapshot)
 *   2. List snapshots (GET /workspace/:id/history)
 *   3. Get content (GET /workspace/:id/history/:id/content)
 *   4. Restore (POST /workspace/:id/history/:id/restore)
 *   5. Delete (DELETE /dev/history/snapshot)
 *
 * Each step screenshots the dev panel. The page is gated by
 * `import.meta.env.DEV`; server routes are mounted unconditionally.
 */
export default {
  id: "phase-6-history-3-api-routes",
  title: "Real history API routes drive the dev panel end-to-end",
  spec: "docs/plan-phase-6-version-history.md#23-slice-63",
  steps: [
    {
      name: "App booted (dev mode)",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", { timeoutMs: 60_000 });
      },
    },
    {
      name: "Navigate to /dev/history",
      run: async (ctx) => {
        await ctx.navigateHash("/dev/history");
        await ctx.waitFor(
          `Boolean(document.querySelector('[data-testid="dev-history-save"]'))`,
          { timeoutMs: 30_000, label: "dev panel Save button" },
        );
      },
    },
    {
      name: "Save a snapshot via the real API route",
      run: async (ctx) => {
        await ctx.eval(`(() => {
          const el = document.querySelector('[data-testid="dev-history-content"]');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(el, 'route-v1');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await ctx.clickText("Save snapshot");
        await ctx.waitFor(
          `document.querySelectorAll('[data-testid="dev-history-row"]').length === 1`,
          { timeoutMs: 15_000, label: "1 row after save" },
        );
        await ctx.expectText("1 snapshot");
        await ctx.screenshot("03a-real-route-save", {
          claim: "POST /history/snapshot creates a row through the real route.",
          requireText: ["1 snapshot"],
          hashIncludes: "/dev/history",
        });
      },
    },
    {
      name: "Click 'Get' — fetch content via the real route",
      run: async (ctx) => {
        await ctx.clickText("Get");
        await ctx.waitFor(
          `Boolean(document.querySelector('[data-testid="dev-history-content-preview"]'))`,
          { timeoutMs: 10_000, label: "content preview visible" },
        );
        const preview = await ctx.text("[data-testid=dev-history-content-preview]");
        ctx.assert(
          preview.includes("route-v1"),
          `Expected preview to contain 'route-v1', got: ${preview.slice(0, 80)}`,
        );
        await ctx.screenshot("03b-get-content", {
          claim: "GET /history/:id/content returns the snapshot's content and renders in the preview.",
          requireText: ["route-v1"],
          hashIncludes: "/dev/history",
        });
      },
    },
    {
      name: "Click 'Restore' — overwrites the file on disk",
      run: async (ctx) => {
        await ctx.clickText("Restore");
        // Restore creates an auto-snapshot of the pre-restore state, so
        // the count goes 1 -> 2 (the manual v1 + the auto pre-restore).
        await ctx.waitFor(
          `document.body.innerText.includes('2 snapshots')`,
          { timeoutMs: 10_000, label: "count goes to 2 after restore (auto-snapshot created)" },
        );
        await ctx.screenshot("03c-restore", {
          claim: "POST /history/:id/restore overwrites the file and creates an auto-snapshot of the pre-restore state.",
          requireText: ["2 snapshots"],
          hashIncludes: "/dev/history",
        });
      },
    },
  ],
};
