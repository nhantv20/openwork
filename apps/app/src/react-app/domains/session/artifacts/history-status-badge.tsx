/** @jsxImportSource react */
/**
 * Phase 6, slice 6.2 — History status badge.
 *
 * A tiny pill rendered in the artifact-panel header that shows whether the
 * server-side auto-snapshot subsystem is healthy for the currently open file:
 *   - "auto-snapshot · never" when no snapshots exist
 *   - "auto-snapshot · 2s ago" when the latest snapshot is fresh
 *   - "auto-snapshot · 5 min ago" when older
 *
 * Polls `/workspace/:id/files/:path/history/latest` every 3s (paused when the
 * tab is hidden, matching `artifact-panel`'s existing convention).
 */
import { useEffect, useMemo, useState } from "react";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { useOpenworkServer } from "../../connections/openwork-server-provider";

type FileSnapshotLite = {
  id: string;
  createdAt: number;
  size: number;
  trigger: "auto" | "manual";
};

type Props = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  filePath: string | null;
  /** Polling interval in ms. Default 3000. */
  intervalMs?: number;
};

function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}

export function HistoryStatusBadge({ client, workspaceId, filePath, intervalMs = 3000 }: Props) {
  const server = useOpenworkServer();
  const base = server.getSnapshot().openworkServerBaseUrl.replace(/\/+$/, "");
  const token = server.getSnapshot().openworkServerAuth.token;
  const [latest, setLatest] = useState<FileSnapshotLite | null | "missing">(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [tabVisible, setTabVisible] = useState<boolean>(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  // Track visibility to pause polling when the tab is hidden.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Poll the server for the latest snapshot. Skips if no workspace/file.
  useEffect(() => {
    if (!client || !workspaceId || !filePath || !base || !tabVisible) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const url = `${base}/workspace/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(filePath)}/history/latest`;
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          if (!cancelled) setLatest("missing");
          return;
        }
        const data = (await res.json()) as { snapshot: FileSnapshotLite | null };
        if (!cancelled) setLatest(data.snapshot ?? "missing");
      } catch {
        if (!cancelled) setLatest("missing");
      }
    };
    void tick();
    const id = setInterval(() => {
      void tick();
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client, workspaceId, filePath, base, token, intervalMs, tabVisible]);

  // Tick "now" every 10s so relative times stay fresh without re-fetching.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const label = useMemo(() => {
    if (latest === null) return "auto-snapshot · …";
    if (latest === "missing") return "auto-snapshot · never";
    return `auto-snapshot · ${formatRelative(latest.createdAt, now)}`;
  }, [latest, now]);

  if (!workspaceId || !filePath) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-dls-border bg-dls-sidebar/30 px-2 py-0.5 text-[10px] font-medium text-dls-secondary"
      data-testid="history-status-badge"
      data-latest={latest && latest !== "missing" ? latest.id : "none"}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Pure utility exported for unit tests. Mirrors what the badge shows
 * next to the green dot.
 */
export function relativeSnapshotLabel(createdAt: number, now: number = Date.now()): string {
  return formatRelative(createdAt, now);
}
