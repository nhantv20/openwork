/** @jsxImportSource react */
import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ExternalLink,
  FileCode,
  Globe,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Server,
  HardDrive,
} from "lucide-react";

import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { createClient, unwrap } from "@/app/lib/opencode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  LayoutSection,
  LayoutSectionContent,
  LayoutSectionHeader,
  LayoutSectionTitle,
  LayoutStack,
} from "../settings-layout";
import { SettingsInset, SettingsNotice } from "../settings-section";
import { openDesktopUrl } from "@/app/lib/desktop";
import { useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";

type ArtifactsViewProps = {
  openworkClient: OpenworkServerClient | null;
  selectedWorkspaceId: string;
  selectedWorkspaceRoot?: string;
  isRemoteWorkspace: boolean;
  activeClient: ReturnType<typeof createClient> | null;
  navigate: (path: string) => void;
};

const ARTIFACT_SERVER = "http://127.0.0.1:26316";
const ARTIFACT_DELETE_API = "http://127.0.0.1:26318";

type ArtifactItem = {
  name: string;
  url: string;
  size: string;
  isHtml: boolean;
};

async function fetchArtifactList(): Promise<ArtifactItem[]> {
  const resp = await fetch(`${ARTIFACT_SERVER}/`, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`Server trả về ${resp.status}`);
  const html = await resp.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const items: ArtifactItem[] = [];

  doc.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || href === "/") return;
    const name = decodeURIComponent(href.replace(/^\//, ""));
    if (name.endsWith(".meta.json")) return;
    if (name === "dashboard.html") return;
    items.push({
      name,
      url: `${ARTIFACT_SERVER}/${encodeURIComponent(name)}`,
      isHtml: /\.(html?|xhtml)$/i.test(name),
      size: "",
    });
  });

  // Fetch sizes in parallel
  await Promise.allSettled(
    items.map(async (item) => {
      try {
        const h = await fetch(item.url, { method: "HEAD" });
        const len = parseInt(h.headers.get("content-length") ?? "0");
        item.size =
          len > 1024 * 1024
            ? (len / 1024 / 1024).toFixed(1) + " MB"
            : len > 1024
              ? (len / 1024).toFixed(1) + " KB"
              : len > 0
                ? len + " B"
                : "—";
      } catch {
        item.size = "—";
      }
    }),
  );

  return items;
}

async function checkServer(): Promise<boolean> {
  try {
    const r = await fetch(`${ARTIFACT_SERVER}/`, { method: "HEAD", cache: "no-cache" });
    return r.ok;
  } catch {
    return false;
  }
}

export function ArtifactsView({
  selectedWorkspaceId,
  selectedWorkspaceRoot,
  activeClient,
  navigate,
}: ArtifactsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [updatingName, setUpdatingName] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const setComposerDraft = useComposerStateStore((state) => state.setDraft);

  const serverHealth = useQuery({
    queryKey: ["artifact-server-health"],
    queryFn: checkServer,
    refetchInterval: 15_000,
  });

  const artifactsQuery = useQuery({
    queryKey: ["artifact-server-files"],
    queryFn: fetchArtifactList,
    enabled: serverHealth.data === true,
    refetchOnMount: true,
    refetchInterval: 30_000,
  });

  const artifacts = artifactsQuery.data ?? [];
  const isServerOnline = serverHealth.data === true;
  const loading = artifactsQuery.isLoading && isServerOnline;

  const filteredArtifacts = useMemo(() => {
    if (!searchQuery.trim()) return artifacts;
    const q = searchQuery.toLowerCase();
    return artifacts.filter((a) => a.name.toLowerCase().includes(q));
  }, [artifacts, searchQuery]);

  const handleRefresh = useCallback(() => {
    void serverHealth.refetch();
    void artifactsQuery.refetch();
  }, [serverHealth, artifactsQuery]);

  const handleDirectDelete = useCallback(
    async (name: string) => {
      const ok = window.confirm(`Xoá "${name}"?\n\nFile và lịch sử cập nhật sẽ bị xoá vĩnh viễn khỏi server.`);
      if (!ok) return;
      setDeletingName(name);
      try {
        const res = await fetch(`${ARTIFACT_DELETE_API}/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          deleted?: string[];
          error?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        toast.success(`Đã xoá ${data.deleted?.join(", ") ?? name}`);
        await artifactsQuery.refetch();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Xoá thất bại", {
          description: `${message}. Đảm bảo DELETE server ở :26318 đang chạy.`,
        });
      } finally {
        setDeletingName(null);
      }
    },
    [artifactsQuery],
  );

  const handleChatAction = useCallback(
    async (action: string) => {
      if (action === "start") {
        toast('Hãy nói "start artifact server" trong chat!');
        return;
      }
      if (action === "stop") {
        toast('Hãy nói "stop artifact server" trong chat!');
        return;
      }
      if (action === "create") {
        if (!activeClient) {
          toast.error("Không có client kết nối tới workspace");
          return;
        }
        if (!selectedWorkspaceId) {
          toast.error("Chưa chọn workspace");
          return;
        }
        setCreating(true);
        try {
          const rawResult = await activeClient.session.create({
            directory: selectedWorkspaceRoot?.trim() || undefined,
          });
          const session = unwrap(rawResult);
          const sessionId = session.id;
          if (!sessionId) {
            toast.error("Không tạo được task mới");
            return;
          }
          const prompt = `/artifact create `;
          setComposerDraft(sessionId, prompt);
          navigate(workspaceSessionRoute(selectedWorkspaceId, sessionId));
          toast.success("Đã mở task mới để tạo artifact");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.error("Lỗi tạo task", { description: message });
        } finally {
          setCreating(false);
        }
        return;
      }
      if (action.startsWith("delete ")) {
        const name = action.replace("delete ", "");
        toast(`Hãy nói "delete artifact ${name}" trong chat!`);
        return;
      }
      if (action.startsWith("update ")) {
        const name = action.replace("update ", "");
        if (!activeClient) {
          toast.error("Không có client kết nối tới workspace");
          return;
        }
        if (!selectedWorkspaceId) {
          toast.error("Chưa chọn workspace");
          return;
        }
        setUpdatingName(name);
        try {
          const rawResult = await activeClient.session.create({
            directory: selectedWorkspaceRoot?.trim() || undefined,
          });
          const session = unwrap(rawResult);
          const sessionId = session.id;
          if (!sessionId) {
            toast.error("Không tạo được task mới");
            return;
          }
          const prompt = `/artifact update ${name}  (Không tạo mới update artifact cũ)\nNội dung bổ sung: `;
          setComposerDraft(sessionId, prompt);
          navigate(workspaceSessionRoute(selectedWorkspaceId, sessionId));
          toast.success(`Đã mở task mới cho artifact "${name}"`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.error("Lỗi tạo task", { description: message });
        } finally {
          setUpdatingName(null);
        }
        return;
      }
    },
    [activeClient, navigate, selectedWorkspaceId, selectedWorkspaceRoot, setComposerDraft],
  );

  const totalSize = useMemo(() => {
    let bytes = 0;
    artifacts.forEach((a) => {
      const raw = a.size;
      if (raw.endsWith("MB")) bytes += parseFloat(raw) * 1024 * 1024;
      else if (raw.endsWith("KB")) bytes += parseFloat(raw) * 1024;
      else if (raw.endsWith("B") && raw !== "—") bytes += parseInt(raw);
    });
    return bytes > 1024 * 1024
      ? (bytes / 1024 / 1024).toFixed(1) + " MB"
      : bytes > 1024
        ? (bytes / 1024).toFixed(1) + " KB"
        : bytes + " B";
  }, [artifacts]);

  return (
    <LayoutStack>
      {/* Header */}
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>
            <Archive className="size-5" />
            Artifact Manager
          </LayoutSectionTitle>
        </LayoutSectionHeader>
        <LayoutSectionContent>
          <p className="text-sm text-muted-foreground">
            Quản lý các HTML artifact được publish từ session. Xem, cập nhật hoặc xóa artifact.
          </p>
        </LayoutSectionContent>
      </LayoutSection>

      {/* Server Status Bar */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border p-4 transition-colors",
          isServerOnline
            ? "border-dls-border bg-dls-surface"
            : "border-red-900/40 bg-red-950/20",
        )}
      >
        <div className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              "inline-block size-2.5 rounded-full",
              isServerOnline
                ? "bg-green-500 shadow-[0_0_8px_#22c55e66]"
                : "bg-red-500",
            )}
          />
          <Server className="size-4 text-muted-foreground" />
          <span className={isServerOnline ? "text-foreground" : "text-muted-foreground"}>
            {isServerOnline ? `Đang chạy • ${ARTIFACT_SERVER}` : "Server đã dừng"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isServerOnline ? (
            <Button variant="outline" size="sm" onClick={() => handleChatAction("stop")}>
              <Pause className="size-3.5 mr-1" />
              Stop
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => handleChatAction("start")}>
              <Play className="size-3.5 mr-1" />
              Start
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={() => handleChatAction("create")}
            disabled={creating || !isServerOnline || !activeClient}
            title="Tạo artifact HTML mới (mở task chat mới)"
          >
            <Plus className="size-3.5 mr-1" />
            New
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={handleRefresh}
            disabled={artifactsQuery.isFetching}
          >
            <RefreshCw className={cn("size-4", artifactsQuery.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col items-center gap-1 rounded-xl border border-dls-border bg-dls-surface p-3">
          <span className="text-lg font-bold text-foreground">{artifacts.length}</span>
          <span className="text-xs text-muted-foreground">Artifacts</span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-xl border border-dls-border bg-dls-surface p-3">
          <span className="text-lg font-bold text-foreground">{totalSize}</span>
          <span className="text-xs text-muted-foreground">Tổng dung lượng</span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-xl border border-dls-border bg-dls-surface p-3">
          <span className="text-lg font-bold text-foreground">
            {isServerOnline ? (
              <Globe className="size-5 text-green-500" />
            ) : (
              <Server className="size-5 text-red-500" />
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {isServerOnline ? "Online" : "Offline"}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm artifact..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {filteredArtifacts.length}/{artifacts.length}
        </span>
      </div>

      {/* Content */}
      {!isServerOnline ? (
        <SettingsInset className="flex flex-col items-center gap-3 py-12 text-center">
          <Server className="size-12 text-muted-foreground/40" />
          <div className="text-sm font-medium text-muted-foreground">Artifact server đã dừng</div>
          <p className="text-xs text-muted-foreground/70 max-w-sm">
            Server đang chạy ở cổng 26316. Nói "start artifact server" trong chat để khởi động.
          </p>
        </SettingsInset>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : artifactsQuery.error ? (
        <SettingsNotice tone="error">
          Không thể tải artifact. Vui lòng thử lại.
        </SettingsNotice>
      ) : filteredArtifacts.length === 0 ? (
        <SettingsInset className="flex flex-col items-center gap-3 py-12 text-center">
          <Archive className="size-12 text-muted-foreground/40" />
          <div className="text-sm font-medium text-muted-foreground">
            {searchQuery ? "Không có artifact nào khớp" : "Chưa có artifact nào"}
          </div>
          <p className="text-xs text-muted-foreground/70 max-w-sm">
            {searchQuery
              ? "Thử từ khóa khác."
              : "Tạo artifact bằng cách yêu cầu trong chat."}
          </p>
        </SettingsInset>
      ) : (
        <div className="grid gap-2">
          {filteredArtifacts.map((artifact) => (
            <div
              key={artifact.name}
              className="group flex items-center gap-4 rounded-xl border border-dls-border bg-dls-surface p-4 transition-colors hover:bg-dls-hover"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-orange-3 text-orange-11">
                <FileCode className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-dls-text">
                    {artifact.name}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                    HTML
                  </Badge>
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-dls-secondary">
                  <HardDrive className="size-3" />
                  <span>{artifact.size}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {/* Update — opens new task with prompt pre-filled */}
                <button
                  className="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-muted-foreground opacity-0 transition-all hover:bg-dls-hover hover:text-foreground focus-visible:outline-none group-hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => void handleChatAction(`update ${artifact.name}`)}
                  title="Mở task mới để cập nhật artifact này"
                  disabled={updatingName === artifact.name || !activeClient}
                >
                  <RefreshCw
                    className={cn("size-4", updatingName === artifact.name && "animate-spin")}
                  />
                </button>

                {/* Delete — calls DELETE API on :26318 directly */}
                <button
                  className="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-muted-foreground opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 focus-visible:outline-none group-hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => void handleDirectDelete(artifact.name)}
                  disabled={deletingName === artifact.name}
                  title="Xoá artifact"
                >
                  <Trash2
                    className={cn(
                      "size-4",
                      deletingName === artifact.name && "animate-spin",
                    )}
                  />
                </button>

                {/* Open in external browser */}
                <button
                  className="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-muted-foreground opacity-0 transition-all hover:bg-dls-hover hover:text-foreground focus-visible:outline-none group-hover:opacity-100"
                  onClick={() => void openDesktopUrl(artifact.url)}
                  title="Mở trong trình duyệt"
                >
                  <ExternalLink className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {isServerOnline && artifacts.length > 0 && (
        <p className="text-xs text-muted-foreground/60">
          {artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""} • {totalSize} • Server{" "}
          {ARTIFACT_SERVER}
        </p>
      )}
    </LayoutStack>
  );
}
