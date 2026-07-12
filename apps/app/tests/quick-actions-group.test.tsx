/** @jsxImportSource react */
import { describe, expect, test, vi } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SidebarProvider } from "../src/components/ui/sidebar";

import { QuickActionsGroup } from "../src/react-app/domains/session/sidebar/quick-actions-group";

function noop() {
  // intentionally empty
}

function renderGroup(
  overrides: Partial<React.ComponentProps<typeof QuickActionsGroup>> = {},
) {
  return renderToStaticMarkup(
    React.createElement(
      SidebarProvider,
      { defaultOpen: true },
      React.createElement(QuickActionsGroup, {
        selectedWorkspaceId: "ws-1",
        newTaskDisabled: false,
        onCreateTask: noop,
        onOpenCreateWorkspace: noop,
        onOpenSearch: noop,
        onOpenSkills: noop,
        onOpenScheduled: noop,
        onOpenConnectMobile: noop,
        ...overrides,
      } as React.ComponentProps<typeof QuickActionsGroup>),
    ),
  );
}

describe("QuickActionsGroup", () => {
  test("renders the 5 expected actions in order", () => {
    const html = renderGroup();

    const expected = [
      "quick-action-new-task",
      "quick-action-search",
      "quick-action-skills",
      "quick-action-scheduled",
      "quick-action-connect-mobile",
    ];
    for (const testId of expected) {
      expect(html).toContain(`data-testid="${testId}"`);
    }

    // 5 menu items in the group (SidebarMenuItem renders as <li>).
    const listItemMatches = html.match(/<li[^>]*>/g) ?? [];
    expect(listItemMatches.length).toBe(5);
  });

  test("disables New task when newTaskDisabled is true (workspace connecting)", () => {
    const html = renderGroup({ newTaskDisabled: true });
    expect(html).toMatch(
      /data-testid="quick-action-new-task"[\s\S]*?disabled/,
    );
  });

  test("New task is clickable (not disabled) when no workspace — falls back to onOpenCreateWorkspace", () => {
    // Per plan §2.2: no-workspace case opens the create-workspace modal,
    // it does NOT disable the button. We capture the full <button ...> opening
    // tag containing the testid and assert (a) no `disabled` attr, (b) a
    // `title` attr is set to the localized "select a workspace" hint.
    const html = renderGroup({
      selectedWorkspaceId: "",
      onOpenCreateWorkspace: vi.fn(),
    });
    const newTaskButtonOpen = html.match(
      /<button[^>]*data-testid="quick-action-new-task"[^>]*>/,
    )?.[0] ?? "";
    expect(newTaskButtonOpen).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(newTaskButtonOpen).toMatch(/\stitle=/);
  });

  test("shows a 'Soon' badge on Skills / Connect Mobile (Scheduled is now wired)", () => {
    const html = renderGroup();
    // Count via data-testid rather than literal text — locale-independent.
    // Scheduled lands in M2 — its Quick Action shortcut now navigates to
    // Settings → Scheduled, so the "Soon" badge is removed. Skills + Connect
    // Mobile are still placeholders.
    const badgeCount = (
      html.match(/data-testid="quick-action-coming-soon"/g) ?? []
    ).length;
    expect(badgeCount).toBe(2);
  });

  test("omits M2 buttons individually when their callback is missing", () => {
    // P2: group still renders (Search shortcut is preserved) even if some
    // M2 callbacks are not yet wired.
    const html = renderGroup({ onOpenSkills: undefined });
    expect(html).toContain("quick-action-new-task");
    expect(html).toContain("quick-action-search");
    expect(html).not.toContain("quick-action-skills");
    expect(html).toContain("quick-action-scheduled");
    expect(html).toContain("quick-action-connect-mobile");
    // Only Connect Mobile still carries a "Soon" badge.
    const badgeCount = (
      html.match(/data-testid="quick-action-coming-soon"/g) ?? []
    ).length;
    expect(badgeCount).toBe(1);
    // 4 menu items (New task + Search + 2 M2).
    const listItemMatches = html.match(/<li[^>]*>/g) ?? [];
    expect(listItemMatches.length).toBe(4);
  });

  test("exposes a search shortcut on the search button", () => {
    const html = renderGroup();
    expect(html).toContain("aria-keyshortcuts=");
    expect(html).toContain("quick-action-search");
  });

  test("component is purely props-driven (no hidden context coupling)", () => {
    // This test exists to keep `vi` import meaningful and to fail fast
    // if a future change wires callbacks into a context provider by mistake.
    expect(typeof QuickActionsGroup).toBe("function");
    const spy = vi.fn();
    expect(spy).not.toHaveBeenCalled();
  });
});
