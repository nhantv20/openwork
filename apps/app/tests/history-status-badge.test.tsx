/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";
import { relativeSnapshotLabel } from "../src/react-app/domains/session/artifacts/history-status-badge";

describe("relativeSnapshotLabel (badge text helper)", () => {
  test("just now", () => {
    const now = 1_000_000;
    expect(relativeSnapshotLabel(now - 2_000, now)).toBe("just now");
  });

  test("seconds ago", () => {
    const now = 1_000_000;
    expect(relativeSnapshotLabel(now - 30_000, now)).toBe("30s ago");
  });

  test("minutes ago", () => {
    const now = 1_000_000;
    expect(relativeSnapshotLabel(now - 5 * 60_000, now)).toBe("5 min ago");
  });

  test("hours ago", () => {
    const now = 1_000_000;
    expect(relativeSnapshotLabel(now - 2 * 3_600_000, now)).toBe("2 h ago");
  });

  test("days ago", () => {
    const now = 1_000_000;
    expect(relativeSnapshotLabel(now - 3 * 86_400_000, now)).toBe("3 d ago");
  });
});
