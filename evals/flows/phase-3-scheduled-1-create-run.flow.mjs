/**
 * Scheduled task: end-to-end smoke for Phase 3 / M2.
 *
 * Validates the user-visible flow:
 *   1. Open Settings → Scheduled tasks tab
 *   2. Click "New task" → dialog opens
 *   3. Fill name + prompt + cron ("* * * * *" for fast fire)
 *   4. Submit → job appears in list with nextRunAt
 *   5. Wait for cron to fire → verify row in list updates (lastRunAt set)
 *   6. Open detail drawer → see run history
 *
 * Drives the real Electron app via CDP through the `fraimz` harness.
 *
 * Status: skeleton — see `__knownGaps` below. To finish:
 *   - confirm clickByText / fillByLabel helpers exist in the harness
 *     (or use direct selectors + accessibility snapshot)
 *   - confirm Settings page exposes a tab labelled "Scheduled tasks"
 *     reachable from sidebar (M1 Quick Actions)
 *   - add a test id to the new-scheduled-task dialog trigger button so the
 *     first interaction does not depend on localized text
 *   - add data-row="<job-name>" and data-col="nextRunAt" / "lastRunAt" to
 *     `scheduled-tasks-view.tsx` so the polling step can be a pure DOM
 *     query without the control API
 */
const __knownGaps = [
  "control API does not yet expose scheduled.* — see apps/app/src/react-app/shell/control/control-provider.tsx",
  "scheduled-tasks-view.tsx rows lack data-row / data-col attributes",
  "create dialog button lacks a stable data-testid",
  "Quick Actions sidebar 'Scheduled' item navigates to settings, but the route param is not yet wired in the fraimz harness",
];

export default {
  id: "phase-3-scheduled-1-create-run",
  title: "Create a scheduled task and verify it fires via cron",
  spec: "evals/react-session-flows.md",
  knownGaps: __knownGaps,
  steps: [
    {
      name: "App is booted and exposes automation control",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 30_000,
          label: "window.__openworkControl",
        });
      },
    },
    {
      name: "Navigate to Settings → Scheduled tasks tab",
      run: async (ctx) => {
        // Navigate via the Quick Actions sidebar (M1 wired).
        await ctx.clickByText("Scheduled", { label: "sidebar Scheduled quick action" });
        await ctx.waitFor("text=settings.tab_scheduled", {
          label: "Scheduled tab heading",
        });
        await ctx.screenshot("settings-scheduled-tab", {
          claim: "Settings page is open with the Scheduled tasks tab visible.",
        });
      },
    },
    {
      name: "Click 'New task' → dialog opens",
      run: async (ctx) => {
        await ctx.clickByText("New task", { label: "open new-scheduled-task dialog" });
        await ctx.waitFor("dialog[open], [role='dialog']", {
          label: "new-scheduled-task dialog",
        });
        await ctx.screenshot("scheduled-new-task-dialog", {
          claim: "Create-scheduled-task dialog is open with name/prompt/cron fields visible.",
        });
      },
    },
    {
      name: "Fill the form (name + prompt + cron) and submit",
      run: async (ctx) => {
        await ctx.fillByLabel("Name", "fraimz-smoke");
        await ctx.fillByLabel("Prompt", "Say hello from a scheduled job");
        await ctx.fillByLabel("Cron expression", "* * * * *");
        // Timezone defaults to Asia/Tokyo per plan §4.1 decision #6.
        await ctx.screenshot("scheduled-new-task-filled", {
          claim: "Form is filled and ready to submit.",
        });
        await ctx.clickByText("Create", { label: "submit create form" });
      },
    },
    {
      name: "Job appears in the list with nextRunAt set",
      run: async (ctx) => {
        await ctx.waitFor("name === 'fraimz-smoke'", {
          label: "row with name=fraimz-smoke",
        });
        const nextRunAt = await ctx.eval(
          "document.querySelector('[data-row=\"fraimz-smoke\"] [data-col=\"nextRunAt\"]')?.textContent",
        );
        ctx.assert(
          nextRunAt && /\d{4}-\d{2}-\d{2}|in \d+/.test(nextRunAt),
          `nextRunAt not rendered: ${nextRunAt}`,
        );
        await ctx.screenshot("scheduled-list-with-job", {
          claim: "Scheduled tasks list shows the new job with a non-empty nextRunAt.",
        });
      },
    },
    {
      name: "Wait for cron to fire (≤ 90s) and verify lastRunAt updates",
      run: async (ctx) => {
        // Poll the DOM directly — control API does not yet expose scheduled.*.
        await ctx.waitFor(
          "document.querySelector('[data-row=\"fraimz-smoke\"] [data-col=\"lastRunAt\"]')?.textContent?.length > 0",
          { timeoutMs: 90_000, intervalMs: 5_000, label: "lastRunAt populated" },
        );
        await ctx.screenshot("scheduled-job-fired", {
          claim: "Job fired and lastRunAt is now populated on the row.",
        });
      },
    },
    {
      name: "Detail drawer shows the run history",
      run: async (ctx) => {
        await ctx.click('[data-row="fraimz-smoke"]', { label: "open detail drawer" });
        await ctx.waitFor("[data-drawer='scheduled-task-detail']", {
          label: "detail drawer",
        });
        await ctx.screenshot("scheduled-detail-drawer", {
          claim: "Detail drawer shows the run history with at least one successful entry linking to the created session.",
        });
      },
    },
  ],
};

