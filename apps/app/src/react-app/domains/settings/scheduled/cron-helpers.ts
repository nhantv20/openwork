/**
 * Cron expression helper utilities (Phase 3 / M2 / S6).
 *
 * Used by the create/edit dialog to:
 * - Validate user-typed cron expressions via croner.
 * - Show a "Next 3 runs" preview computed in the browser (no server
 *   round-trip — the UI feels instant).
 * - Offer 5 quick-fill chips: every minute / every hour / every day
 *   at 9am / every Monday / weekdays 9am.
 *
 * Mirrors the UX the plan calls out in §3.6 + §3.7.
 */
import { Cron } from "croner";

export type CronChip = {
  id: string;
  label: string;
  /** A 5-part POSIX cron expression. */
  expression: string;
};

export const CRON_CHIPS: CronChip[] = [
  { id: "every-minute", label: "Every minute", expression: "* * * * *" },
  { id: "every-hour", label: "Every hour", expression: "0 * * * *" },
  { id: "every-day-9am", label: "Every day at 9am", expression: "0 9 * * *" },
  { id: "every-monday", label: "Every Monday", expression: "0 9 * * 1" },
  { id: "weekdays-9am", label: "Weekdays 9am", expression: "0 9 * * 1-5" },
];

export const DEFAULT_TIMEZONE = "Asia/Tokyo";

export type CronValidation =
  | { ok: true; nextRuns: Date[] }
  | { ok: false; error: string };

/** Validate a cron expression + timezone combination, returning either
 *  the next 3 runs in the given timezone, or the error message. */
export function validateCron(expression: string, timezone: string): CronValidation {
  const trimmed = expression.trim();
  if (!trimmed) {
    return { ok: false, error: "Cron expression is required" };
  }
  try {
    const c = new Cron(trimmed, { timezone });
    const next = c.nextRuns(3);
    return { ok: true, nextRuns: next };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid cron expression",
    };
  }
}

/** A minimal IANA timezone list — covers the common cases without
 *  shipping the full ICU database. S6 ships this; later we can swap
 *  to a curated JSON file if users need more. */
export const COMMON_TIMEZONES: string[] = [
  "Asia/Tokyo",
  "Asia/Ho_Chi_Minh",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Seoul",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Europe/Rome",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "America/Mexico_City",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "UTC",
];

/** Format a Date for the next-runs preview. Uses Intl.DateTimeFormat so
 *  the user sees the date in the job's timezone, not the browser's. */
export function formatNextRun(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    }).format(date);
  } catch {
    // Bad timezone → fall back to local formatting.
    return date.toLocaleString();
  }
}
