/** @jsxImportSource react */
/**
 * `/_dev/history` debug panel (Phase 6, slice 6.1).
 *
 * A minimal React page that drives the dev-only `SnapshotStore` HTTP bridge.
 * Purpose: prove end-to-end that the schema, store, and HTTP layer all work
 * before the real per-workspace endpoints ship in slice 6.3.
 *
 * Gating: this component renders nothing in prod builds. The route in
 * `app-root.tsx` wraps it in `import.meta.env.DEV` and the component itself
 * also short-circuits if `OPENWORK_DEV_MODE` is not active on the server.
 */
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useDevHistoryBridge, type DevSnapshot } from "./history-debug-bridge";

const cardClass =
  "rounded-2xl border border-dls-border bg-dls-surface/95 p-5 space-y-3";
const labelClass = "text-[11px] font-medium uppercase tracking-wide text-dls-secondary";
const inputClass =
  "h-9 w-full rounded-lg border border-dls-border bg-dls-sidebar/40 px-3 text-[13px] text-dls-text outline-none focus:border-dls-text/40";
const textareaClass =
  "min-h-24 w-full rounded-lg border border-dls-border bg-dls-sidebar/40 p-2 text-[12px] font-mono text-dls-text outline-none focus:border-dls-text/40";
const tableClass =
  "w-full text-left text-[12px] text-dls-secondary [&_th]:text-[10px] [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-dls-secondary [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3";

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

type SaveStatus = "idle" | "saving" | "saved" | "deduped" | "error";

export function HistoryDebugPage() {
  if (!import.meta.env.DEV) return null;

  const bridge = useDevHistoryBridge();
  const [workspaceId, setWorkspaceId] = useState("ws_debug");
  const [filePath, setFilePath] = useState("src/example.ts");
  const [content, setContent] = useState("hello world");
  const [items, setItems] = useState<DevSnapshot[]>([]);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastContent, setLastContent] = useState<string | null>(null);

  const refresh = useMemo(
    () => async () => {
      if (!bridge.isReady) return;
      setLastError(null);
      try {
        const [listResult, countResult] = await Promise.all([
          bridge.list({ workspaceId, filePath, limit: 50 }),
          bridge.count({ workspaceId, filePath }),
        ]);
        setItems(listResult.items);
        setCount(countResult.count);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
      }
    },
    [bridge, workspaceId, filePath],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSave = async () => {
    setStatus("saving");
    setLastError(null);
    try {
      const result = await bridge.save({ workspaceId, filePath, content, trigger: "manual" });
      setStatus(result.deduped ? "deduped" : "saved");
      await refresh();
    } catch (err) {
      setStatus("error");
      setLastError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async (snapshotId: string) => {
    setLastError(null);
    try {
      await bridge.remove({ workspaceId, snapshotId });
      await refresh();
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    }
  };

  const onGetContent = async (snapshotId: string) => {
    setLastError(null);
    try {
      const result = await bridge.getContent({ workspaceId, filePath, snapshotId });
      setLastContent(result.content);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    }
  };

  const onRestore = async (snapshotId: string) => {
    setLastError(null);
    try {
      await bridge.restore({ workspaceId, filePath, snapshotId });
      await refresh();
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <header className="space-y-1">
        <h1 className="text-[18px] font-semibold text-dls-text">History debug (slice 6.1)</h1>
        <p className="text-[12px] text-dls-secondary">
          Direct bridge to <code className="font-mono">SnapshotStore</code>. Dev-only — refuses in prod builds.
        </p>
      </header>

      <section className={cardClass}>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className={labelClass}>workspaceId</div>
            <input
              className={inputClass}
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              data-testid="dev-history-workspace"
            />
          </div>
          <div className="space-y-1">
            <div className={labelClass}>filePath</div>
            <input
              className={inputClass}
              value={filePath}
              onChange={(event) => setFilePath(event.target.value)}
              data-testid="dev-history-file"
            />
          </div>
        </div>
        <div className="space-y-1">
          <div className={labelClass}>content</div>
          <textarea
            className={textareaClass}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            data-testid="dev-history-content"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={onSave}
            disabled={status === "saving" || !bridge.isReady}
            data-testid="dev-history-save"
            size="sm"
          >
            {status === "saving" ? "Saving…" : "Save snapshot"}
          </Button>
          <Button
            onClick={refresh}
            variant="outline"
            size="sm"
            disabled={!bridge.isReady}
            data-testid="dev-history-refresh"
          >
            Refresh
          </Button>
          <span className="text-[11px] text-dls-secondary" data-testid="dev-history-count">
            {count} snapshot{count === 1 ? "" : "s"}
          </span>
          {status === "saved" && (
            <span className="text-[11px] text-emerald-500">Saved (new row)</span>
          )}
          {status === "deduped" && (
            <span className="text-[11px] text-amber-500">Deduped (no change)</span>
          )}
          {status === "error" && lastError && (
            <span className="text-[11px] text-red-500">{lastError}</span>
          )}
        </div>
      </section>

      <section className={cardClass}>
        <div className={labelClass}>Snapshots for {filePath}</div>
        {items.length === 0 ? (
          <div className="text-[12px] text-dls-secondary">No snapshots yet.</div>
        ) : (
          <table className={tableClass}>
            <thead>
              <tr>
                <th>id</th>
                <th>created</th>
                <th>size</th>
                <th>trigger</th>
                <th>hash (short)</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} data-testid="dev-history-row">
                  <td className="font-mono text-[11px]">{item.id.slice(0, 12)}…</td>
                  <td className="font-mono text-[11px]">{formatTimestamp(item.createdAt)}</td>
                  <td>{item.size} B</td>
                  <td>{item.trigger}</td>
                  <td className="font-mono text-[11px]">{item.contentHash.slice(0, 8)}…</td>
                  <td className="space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void onGetContent(item.id)}
                      data-testid="dev-history-get-content"
                    >
                      Get
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void onRestore(item.id)}
                      data-testid="dev-history-restore"
                    >
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(item.id)}
                      data-testid="dev-history-delete"
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {lastContent ? (
          <pre
            className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-dls-border bg-dls-sidebar/40 p-2 text-[11px] font-mono text-dls-text"
            data-testid="dev-history-content-preview"
          >
            {lastContent}
          </pre>
        ) : null}
      </section>
    </div>
  );
}
