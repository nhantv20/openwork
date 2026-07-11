/**
 * Phase 6, slice 6.1 — SnapshotStore + dev panel + dev HTTP bridge.
 *
 * Drives the `/_dev/history` React page through:
 *   1. Initial empty render
 *   2. Save first snapshot
 *   3. Save second snapshot (dedup expected)
 *   4. Save third snapshot (new content, count = 2)
 *   5. Delete one, count = 1
 *
 * Each step screenshots the panel. The page only renders when the Vite dev
 * build is active (route gated by `import.meta.env.DEV`); the runner
 * therefore must launch the app via `pnpm dev:ui` (not `pnpm build && preview`).
 *
 * Server side: the `/dev/history/*` routes are mounted only when
 * `OPENWORK_DEV_MODE=1` is set in the openwork-server process. The standard
 * `pnpm dev` chain sets it.
 */
export default {
  id: "phase-6-history-1-schema",
  title: "SnapshotStore + dev panel: save, dedup, count, delete",
  spec: "docs/plan-phase-6-version-history.md#21-slice-61",
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
      name: "Initial render shows 0 snapshots",
      run: async (ctx) => {
        await ctx.expectText("History debug (slice 6.1)");
        await ctx.expectText("0 snapshots");
        await ctx.screenshot("01a-empty-panel", {
          claim: "Dev panel renders empty state with 0 snapshots.",
          requireText: ["History debug (slice 6.1)", "Save snapshot", "0 snapshots"],
          hashIncludes: "/dev/history",
        });
      },
    },
    {
      name: "Save first snapshot",
      run: async (ctx) => {
        // Type content via React-friendly native setter.
        await ctx.eval(`(() => {
          const el = document.querySelector('[data-testid="dev-history-content"]');
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(el, 'first version');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        await ctx.clickText("Save snapshot");
        await ctx.waitFor(
          `document.querySelectorAll('[data-testid="dev-history-row"]').length === 1`,
          { timeoutMs: 15_000, label: "row appears" },
        );
        await ctx.expectText("1 snapshot");
        await ctx.screenshot("01b-after-first-save", {
          claim: "After saving, count goes to 1 and a row appears in the table.",
          requireText: ["1 snapshot", "Save snapshot"],
          hashIncludes: "/dev/history",
        });
      },
    },
    {
      name: "Save same content — dedup, count still 1",
      run: async (ctx) => {
        await ctx.clickText("Save snapshot");
        await ctx.waitFor(
          `(() => { const t = document.body.innerText; return t.includes('1 snapshot') && !t.includes('2 snapshots'); })()`,
          { timeoutMs: 10_000, label: "count stays 1 after dedup" },
        );
        const rows = await ctx.eval(
          "document.querySelectorAll('[data-testid=\"dev-history-row\"]').length",
        );
        ctx.assert(rows === 1, `Expected 1 row after dedup, got ${rows}`);
        await ctx.screenshot("01c-dedup-still-one-row", {
          claim: "Re-saving the same content is deduped; row count stays at 1.",
          requireText: ["1 snapshot"],
          hashIncludes: "/dev/history",
        });
      },
    },
    {
      name: "Save new content — count goes to 2",
      run: async (ctx) => {
        await ctx.eval(`(() => {
          const el = document.querySelector('[data-testid="dev-history-content"]');
          if (!el) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(el, 'second version');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        await ctx.clickText("Save snapshot");
        await ctx.waitFor(
          `document.body.innerText.includes('2 snapshots')`,
          { timeoutMs: 10_000, label: "count goes to 2" },
        );
        await ctx.screenshot("01d-two-rows", {
          claim: "Saving distinct content adds a second row.",
          requireText: ["2 snapshots"],
          hashIncludes: "/dev/history",
        });
      },
    },
    {
      name: "Delete one row — count back to 1",
      run: async (ctx) => {
        await ctx.clickText("Delete");
        await ctx.waitFor(
          `(() => { const t = document.body.innerText; return t.includes('1 snapshot') && !t.includes('2 snapshots'); })()`,
          { timeoutMs: 10_000, label: "count back to 1 after delete" },
        );
        await ctx.screenshot("01e-after-delete", {
          claim: "Deleting a snapshot removes the row and drops the count back to 1.",
          requireText: ["1 snapshot"],
          hashIncludes: "/dev/history",
        });
      },
    },
  ],
};
