/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Server,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  LayoutSection,
  LayoutSectionContent,
  LayoutSectionHeader,
  LayoutSectionTitle,
  LayoutStack,
} from "../settings-layout";
import { openDesktopUrl } from "@/app/lib/desktop";
import {
  pillGhostClass,
  pillPrimaryClass,
} from "@/react-app/domains/workspace/modal-styles";
import { cn } from "@/lib/utils";

const MCP_DASHBOARD_API = "http://127.0.0.1:26320/api";
const MCP_DASHBOARD_URL = "http://127.0.0.1:26320/dashboard";

type ServerStatus = "connected" | "failed" | "idle";

type McpServer = {
  name: string;
  type: string;
  endpoint: string;
  enabled: boolean;
  engineStatus: string | null;
  engineError: string | null;
  config: Record<string, unknown>;
};

type ApiPayload = {
  statuses: McpServer[];
};

type Props = {
  className?: string;
};

function statusOf(s: McpServer): ServerStatus {
  if (s.engineStatus === "connected") return "connected";
  if (s.engineStatus === "failed") return "failed";
  return "idle";
}

function statusLabel(s: McpServer): string {
  if (s.engineStatus === "connected") return "connected";
  if (s.engineStatus === "failed") return "failed";
  return s.engineStatus ?? "idle";
}

const STATUS_DOT: Record<ServerStatus, string> = {
  connected: "bg-green-500 shadow-[0_0_8px_#22c55e66]",
  failed: "bg-red-500",
  idle: "bg-yellow-500",
};

const STATUS_BADGE: Record<ServerStatus, string> = {
  connected: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
  failed: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  idle: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
};

export function McpDashboardView({ className }: Props) {
  const [data, setData] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | ServerStatus>("all");
  const [selected, setSelected] = useState<McpServer | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useMemo(
    () => async () => {
      try {
        const r = await fetch(MCP_DASHBOARD_API, { cache: "no-cache" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as ApiPayload;
        setData(j.statuses ?? []);
        setError(null);
        setUpdatedAt(new Date());
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter((s) => {
      if (filter !== "all" && statusOf(s) !== filter) return false;
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.endpoint.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [data, search, filter]);

  const summary = useMemo(() => {
    const total = data?.length ?? 0;
    const connected = data?.filter((s) => statusOf(s) === "connected").length ?? 0;
    const failed = data?.filter((s) => statusOf(s) === "failed").length ?? 0;
    const idle = total - connected - failed;
    return { total, connected, failed, idle };
  }, [data]);

  return (
    <LayoutStack className={className}>
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>
            <Server className="size-5" />
            MCP Dashboard
          </LayoutSectionTitle>
        </LayoutSectionHeader>
        <LayoutSectionContent>
          <p className="text-sm text-dls-secondary">
            Trạng thái các MCP server trong workspace. Dashboard chạy ở{" "}
            <code className="rounded bg-dls-surface px-1.5 py-0.5 text-xs text-dls-text">
              127.0.0.1:26320
            </code>
            .
          </p>
        </LayoutSectionContent>
      </LayoutSection>

      {/* Status bar */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border p-4 transition-colors",
          error ? "border-red-900/40 bg-red-950/20" : "border-dls-border bg-dls-surface",
        )}
      >
        <span
          className={cn(
            "inline-block size-2.5 rounded-full",
            error ? "bg-red-500" : "bg-green-500 shadow-[0_0_8px_#22c55e66]",
          )}
        />
        <Server className="size-4 text-dls-secondary" />
        <span className="text-sm text-dls-text">
          {error ? `Server chưa chạy (${error})` : `Đang chạy • ${MCP_DASHBOARD_API}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void load()}
            title="Reload"
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openDesktopUrl(MCP_DASHBOARD_URL)}
            title="Mở dashboard gốc trong trình duyệt ngoài"
          >
            <ExternalLink className="size-3.5 mr-1" />
            Mở tab riêng
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total" value={summary.total} />
        <StatCard label="Connected" value={summary.connected} tone="green" />
        <StatCard label="Failed" value={summary.failed} tone={summary.failed > 0 ? "red" : "default"} />
        <StatCard label="Idle" value={summary.idle} tone="yellow" />
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-dls-secondary" />
          <Input
            placeholder="Tìm MCP server..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {(["all", "connected", "failed", "idle"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(filter === f ? pillPrimaryClass : pillGhostClass)}
            >
              {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="shrink-0 text-xs text-dls-secondary whitespace-nowrap">
          {filtered.length}/{summary.total}
        </span>
      </div>

      {/* List */}
      {error && !data ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-dls-border bg-dls-surface/50 py-12 text-center">
          <Server className="size-12 text-dls-secondary/40" />
          <div className="text-sm font-medium text-dls-secondary">
            MCP Dashboard chưa chạy
          </div>
          <p className="max-w-md text-xs text-dls-secondary/70">
            Khởi động bằng lệnh trong terminal của workspace:
            <code className="mt-2 block rounded bg-dls-surface px-3 py-2 text-[11px] text-dls-text">
              node apps/server/scripts/dashboard.mjs
            </code>
            hoặc nói với agent: <em>"start MCP dashboard"</em>.
          </p>
        </div>
      ) : data === null ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-dls-secondary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-dls-border py-12 text-sm text-dls-secondary">
          {search ? "Không có server nào khớp" : "Chưa cấu hình MCP server"}
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((s) => {
            const status = statusOf(s);
            const initial = (s.name || "?")[0].toUpperCase();
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => setSelected(s)}
                className="group flex items-center gap-4 rounded-xl border border-dls-border bg-dls-surface p-4 text-left transition-colors hover:bg-dls-hover"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-orange-3 font-mono text-sm font-semibold text-orange-11">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-dls-text">
                      {s.name}
                    </span>
                    <span className="shrink-0 rounded-md border border-dls-border bg-dls-surface px-1.5 py-0 text-[10px] font-medium text-dls-secondary">
                      {s.type}
                    </span>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        STATUS_BADGE[status],
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
                      {statusLabel(s)}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-dls-secondary">
                    {s.endpoint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="text-right text-xs text-dls-secondary">
        Cập nhật: {updatedAt ? updatedAt.toLocaleTimeString() : "—"}
      </div>

      {/* Detail modal */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="w-full max-w-2xl sm:max-w-2xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription>
                  MCP server details · type: {selected.type}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 py-2">
                <Field label="Type" value={selected.type} />
                <Field label="Status" value={statusLabel(selected)} />
                <Field label="Endpoint" value={selected.endpoint} className="col-span-2" />
                <Field label="Enabled" value={String(selected.enabled)} />
                <Field label="Engine" value={selected.engineStatus ?? "not synced"} />
              </div>
              {selected.engineError ? (
                <div className="mb-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-dls-secondary">
                    Error
                  </div>
                  <div className="break-all rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                    {selected.engineError}
                  </div>
                </div>
              ) : null}
              <div>
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-dls-secondary">
                  Config
                </div>
                <pre className="max-h-64 overflow-auto rounded-md border border-dls-border bg-dls-surface p-3 text-[11px] leading-relaxed text-dls-text">
                  {JSON.stringify(selected.config ?? {}, null, 2)}
                </pre>
              </div>
              <DialogFooter>
                <DialogClose render={<Button variant="outline">Đóng</Button>} />
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </LayoutStack>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "green" | "red" | "yellow";
}) {
  const toneClass: Record<NonNullable<typeof tone>, string> = {
    default: "text-dls-text",
    green: "text-green-600 dark:text-green-400",
    red: "text-red-600 dark:text-red-400",
    yellow: "text-yellow-600 dark:text-yellow-400",
  };
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dls-border bg-dls-surface p-3">
      <span className={cn("text-lg font-bold", toneClass[tone])}>{value}</span>
      <span className="text-xs text-dls-secondary">{label}</span>
    </div>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-dls-secondary">
        {label}
      </div>
      <div className="break-all rounded-md border border-dls-border bg-dls-surface px-3 py-2 font-mono text-xs text-dls-text">
        {value}
      </div>
    </div>
  );
}
