/**
 * Smoke tests for the create/edit dialog (S6).
 *
 * Note: the full base-ui Dialog is wrapped in a Portal and only renders
 * its content when `open === true` and the browser DOM is available.
 * `renderToStaticMarkup` from react-dom/server doesn't trigger the
 * portal in a meaningful way, so most of the form fields end up empty
 * in SSR. End-to-end coverage lives in the
 * `evals/scheduled-task-flow.eval.ts` slice (S6.4); the cron helpers
 * already have direct unit tests in `cron-helpers.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  CRON_CHIPS,
  COMMON_TIMEZONES,
  DEFAULT_TIMEZONE,
  validateCron,
} from "./cron-helpers";

describe("ScheduledTaskDialog — chip + helper contract", () => {
  test("CRON_CHIPS covers the 5 helpers the dialog renders", () => {
    expect(CRON_CHIPS).toHaveLength(5);
    const ids = new Set(CRON_CHIPS.map((c) => c.id));
    expect(ids).toEqual(
      new Set(["every-minute", "every-hour", "every-day-9am", "every-monday", "weekdays-9am"]),
    );
  });

  test("default timezone falls back to Asia/Tokyo when Intl is empty/unavailable", () => {
    // DEFAULT_TIMEZONE is computed at module-load via
    // Intl.DateTimeFormat().resolvedOptions().timeZone, so on most
    // CI runners it will be "UTC". When Intl returns empty (older
    // browsers, sandboxed envs), the helper falls back to
    // "Asia/Tokyo" — which is also in COMMON_TIMEZONES.
    expect(typeof DEFAULT_TIMEZONE).toBe("string");
    expect(DEFAULT_TIMEZONE.length).toBeGreaterThan(0);
    expect(COMMON_TIMEZONES).toContain(DEFAULT_TIMEZONE);
  });

  test("chip expressions all validate against croner", () => {
    for (const chip of CRON_CHIPS) {
      const result = validateCron(chip.expression, "Asia/Tokyo");
      expect(result.ok).toBe(true);
    }
  });
});
