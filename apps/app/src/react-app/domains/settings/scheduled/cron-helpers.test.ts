/**
 * Unit tests for the cron helper utilities (S6).
 */
import { describe, expect, test } from "bun:test";

import {
  COMMON_TIMEZONES,
  CRON_CHIPS,
  DEFAULT_TIMEZONE,
  formatNextRun,
  validateCron,
} from "./cron-helpers";

describe("CRON_CHIPS", () => {
  test("ships 5 helper chips", () => {
    expect(CRON_CHIPS).toHaveLength(5);
    for (const chip of CRON_CHIPS) {
      expect(chip.id).toBeTruthy();
      expect(chip.label).toBeTruthy();
      // Each chip is 5-part POSIX cron.
      expect(chip.expression.split(/\s+/)).toHaveLength(5);
    }
  });
});

describe("validateCron", () => {
  test("returns next 3 runs for a valid expression", () => {
    const result = validateCron("*/5 * * * *", "Asia/Tokyo");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nextRuns).toHaveLength(3);
      // Each next run is in the future.
      for (const d of result.nextRuns) {
        expect(d.getTime()).toBeGreaterThan(Date.now() - 1000);
      }
    }
  });

  test("rejects an empty expression", () => {
    const result = validateCron("   ", "Asia/Tokyo");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("required");
    }
  });

  test("rejects a malformed expression with the underlying error", () => {
    const result = validateCron("not a cron", "Asia/Tokyo");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  test("rejects a bad timezone", () => {
    const result = validateCron("0 9 * * *", "Not/A_Zone");
    expect(result.ok).toBe(false);
  });
});

describe("DEFAULT_TIMEZONE", () => {
  test("is resolved from the system locale (UTC in CI, user TZ in the app)", () => {
    // `DEFAULT_TIMEZONE` is computed at module-load via
    // `Intl.DateTimeFormat().resolvedOptions().timeZone`. In CI (no
    // user locale) it falls back to "Asia/Tokyo"; in a real app it
    // picks the user's actual timezone. Either way it must be a
    // non-empty string the engine accepts as a valid IANA zone.
    expect(typeof DEFAULT_TIMEZONE).toBe("string");
    expect(DEFAULT_TIMEZONE.length).toBeGreaterThan(0);
    // The fallback string must still be in the common list so the
    // <Select> doesn't reject it.
    expect(COMMON_TIMEZONES).toContain(DEFAULT_TIMEZONE);
  });
});

describe("COMMON_TIMEZONES", () => {
  test("contains Asia/Tokyo as the default", () => {
    expect(COMMON_TIMEZONES).toContain("Asia/Tokyo");
  });
  test("contains UTC", () => {
    expect(COMMON_TIMEZONES).toContain("UTC");
  });
  test("has at least 20 entries", () => {
    expect(COMMON_TIMEZONES.length).toBeGreaterThanOrEqual(20);
  });
});

describe("formatNextRun", () => {
  test("returns a non-empty string for a valid date + timezone", () => {
    const formatted = formatNextRun(new Date(), "Asia/Tokyo");
    expect(formatted.length).toBeGreaterThan(0);
  });
  test("falls back gracefully for a bad timezone", () => {
    const formatted = formatNextRun(new Date(), "Not/A_Zone");
    expect(formatted.length).toBeGreaterThan(0);
  });
});
