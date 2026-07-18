/**
 * Scheduled tasks settings view (Phase 3 / M2 / S5 + S6, refreshed for
 * Phase 3.1 to match the Settings → Artifacts layout).
 *
 * Lists cron jobs for the current workspace. Layout mirrors the
 * artifacts manager so users can build muscle memory between the two
 * sections:
 *
 * - Status bar at the top — turns red when the in-process scheduler
 *   is offline (server started with `--disable-scheduler`, or
 *   standalone orchestrator-hosted scheduler not running). Tells
 *   the user *why* jobs aren't firing instead of silently showing
 *   a stale list.
 * - Three stat cards: total jobs / enabled jobs / failed last 24h.
 *   The failed count surfaces jobs that need attention without
 *   requiring the user to open every drawer.
 * - Search + status filter on the list.
 * - Row click opens the detail drawer; Edit + Delete live in the row
 *   for power users.
 *
 * The Quick Actions sidebar button (`onOpenScheduled`) navigates
 * to `/settings/scheduled` via `handleOpenSettings` in `session-route.tsx`.
 */
import { useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  Power,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  SettingsInset,
  SettingsNotice,
  SettingsSection,
  SettingsSectionHeader,
  SettingsSectionHeaderTitle,
  SettingsSectionHeaderDescription,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";
import { t } from "@/i18n";
import type {
  OpenworkScheduledJob,
  OpenworkScheduledRun,
  OpenworkServerClient,
  OpenworkWorkspaceInfo,
} from "@/app/lib/openwork-server";
import { ScheduledTaskDialog } from "./scheduled-task-dialog";
import { ScheduledTaskDetailDrawer } from "./scheduled-task-detail-drawer";
import { cn } from "@/lib/utils";

export type ScheduledTasksViewProps = {
  openworkServerClient: OpenworkServerClient | null;
  selectedWorkspaceId: string;
  /** Optional: navigate to a session from the detail drawer. */
  onOpenSession?: (sessionId: string) => void;
  /** When true, render only the list — used by the sidebar popout.
   *  Hides the header, status bar, and stats cards so the panel stays
   *  compact. */
  compact?: boolean;
  /** All known workspaces so the create dialog can offer a
   *  selector. When the list has 0 or 1 entries, the selector is
   *  hidden (single-workspace users see no extra UI noise). */
  workspaces?: OpenworkWorkspaceInfo[];
};

type FilterMode = "all" | "enabled" | "disabled";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function ScheduledTasksView(props: ScheduledTasksViewProps) {
  const queryClient = useQueryClient();
  const enabled = Boolean(props.openworkServerClient) && Boolean(props.selectedWorkspaceId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogJob, setDialogJob] = useState<OpenworkScheduledJob | null>(null);
  const [drawerJob, setDrawerJob] = useState<OpenworkScheduledJob | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  // Health probe — tells us whether the in-process scheduler is alive.
  // When the server was started with `--disable-scheduler` (e.g. the
  // desktop app), this returns `schedulerRunning: false` and we show
  // the offline banner.
  const healthQuery = useQuery({
    queryKey: ["scheduled-health"],
    enabled: Boolean(props.openworkServerClient),
    queryFn: async () => {
      if (!props.openworkServerClient) throw new Error("no client");
      return props.openworkServerClient.getScheduledHealth();
    },
    refetchInterval: 15_000,
  });

  const jobsQuery = useQuery({
    queryKey: ["scheduled-jobs", props.selectedWorkspaceId],
    enabled,
    queryFn: async () => {
      if (!props.openworkServerClient) {
        throw new Error("OpenWork server is not connected");
      }
      const result = await props.openworkServerClient.listScheduledJobs(props.selectedWorkspaceId);
      return result.jobs;
    },
  });

  // Aggregate run stats across every job in the workspace so the stat
  // card "failed last 24h" stays fresh without opening drawers. We
  // fetch the most-recent 5 runs per job, which is enough for the
  // recent-failure surface; the per-job drawer still owns the full
  // history.
  const runsQuery = useQuery({
    queryKey: ["scheduled-job-runs-aggregate", props.selectedWorkspaceId],
    enabled: enabled && (jobsQuery.data?.length ?? 0) > 0,
    queryFn: async (): Promise<Array<{ jobId: string; runs: OpenworkScheduledRun[] }>> => {
      if (!props.openworkServerClient) throw new Error("no client");
      const jobs = jobsQuery.data ?? [];
      const results = await Promise.all(
        jobs.map(async (job) => {
          const r = await props.openworkServerClient!.listScheduledJobRuns(job.id, { limit: 5 });
          return { jobId: job.id, runs: r.runs };
        }),
      );
      return results;
    },
    refetchInterval: 30_000,
  });

  // Same catalog the dialog fetches — used to show a human-friendly
  // model label in the list row instead of the raw `"providerID/modelID"`
  // string we store on disk.
  const modelsQuery = useQuery({
    queryKey: ["scheduled-models", props.selectedWorkspaceId],
    enabled,
    queryFn: async () => {
      if (!props.openworkServerClient) {
        throw new Error("OpenWork server is not connected");
      }
      return props.openworkServerClient.listScheduledModels(props.selectedWorkspaceId);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (input: { jobId: string; enabled: boolean }) => {
      if (!props.openworkServerClient) {
        throw new Error("OpenWork server is not connected");
      }
      const result = await props.openworkServerClient.updateScheduledJob(input.jobId, { enabled: input.enabled });
      return result.job;
    },
    onSuccess: (job) => {
      queryClient.setQueryData(
        ["scheduled-jobs", props.selectedWorkspaceId],
        (current: typeof jobsQuery.data) => current?.map((j) => (j.id === job.id ? job : j)),
      );
    },
    onError: (err) => {
      toast(t("settings.scheduled_toggle_failed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (jobId: string) => {
      if (!props.openworkServerClient) throw new Error("no client");
      await props.openworkServerClient.deleteScheduledJob(jobId);
    },
    onSuccess: (_void, jobId) => {
      toast(t("settings.scheduled_delete_succeeded"));
      queryClient.setQueryData(
        ["scheduled-jobs", props.selectedWorkspaceId],
        (current: typeof jobsQuery.data) => current?.filter((j) => j.id !== jobId),
      );
      queryClient.removeQueries({ queryKey: ["scheduled-job-runs", jobId] });
      if (drawerJob?.id === jobId) setDrawerJob(null);
    },
    onError: (err) => {
      toast(t("settings.scheduled_delete_failed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const jobs = jobsQuery.data ?? [];
  const isSchedulerRunning = healthQuery.data?.schedulerRunning === true;
  const now = Date.now();

  const stats = useMemo(() => {
    const enabledCount = jobs.filter((j) => j.enabled).length;
    const disabledCount = jobs.length - enabledCount;
    let failedLast24h = 0;
    for (const group of runsQuery.data ?? []) {
      for (const run of group.runs) {
        if (run.status === "failed" && run.finishedAt !== null && now - run.finishedAt < ONE_DAY_MS) {
          failedLast24h += 1;
        }
      }
    }
    return {
      total: jobs.length,
      enabled: enabledCount,
      disabled: disabledCount,
      failedLast24h,
    };
  }, [jobs, runsQuery.data, now]);

  const filteredJobs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return jobs.filter((j) => {
      if (filter === "enabled" && !j.enabled) return false;
      if (filter === "disabled" && j.enabled) return false;
      if (!q) return true;
      return (
        j.name.toLowerCase().includes(q) ||
        j.prompt.toLowerCase().includes(q) ||
        j.cronExpression.toLowerCase().includes(q)
      );
    });
  }, [jobs, searchQuery, filter]);

  const openNewDialog = () => {
    setDialogJob(null);
    setDialogOpen(true);
  };
  const openEditDialog = (job: OpenworkScheduledJob) => {
    setDialogJob(job);
    setDialogOpen(true);
  };
  const openDrawer = (job: OpenworkScheduledJob) => {
    setDrawerJob(job);
  };

  const handleRefresh = () => {
    void jobsQuery.refetch();
    void runsQuery.refetch();
    void healthQuery.refetch();
  };

  const compact = props.compact === true;

  return (
    <LayoutStack>
      {!compact ? (
        <>
          {/* Header */}
          <SettingsSection>
            <SettingsSectionHeader>
              <div className="flex flex-1 items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <SettingsSectionHeaderTitle>
                    {t("settings.scheduled_section_title")}
                  </SettingsSectionHeaderTitle>
                  <SettingsSectionHeaderDescription>
                    {t("settings.scheduled_section_description")}
                  </SettingsSectionHeaderDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    onClick={handleRefresh}
                    disabled={jobsQuery.isFetching || runsQuery.isFetching}
                    aria-label="Refresh"
                  >
                    <Loader2 className={cn("size-4", (jobsQuery.isFetching || runsQuery.isFetching) && "animate-spin")} />
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="shrink-0"
                    onClick={openNewDialog}
                    disabled={!enabled || !isSchedulerRunning}
                    data-testid="scheduled-new-button"
                    title={!isSchedulerRunning ? t("settings.scheduled_health_offline_hint") : undefined}
                  >
                    <Plus className="size-3.5 mr-1" />
                    {t("settings.scheduled_new_button")}
                  </Button>
                </div>
              </div>
            </SettingsSectionHeader>
          </SettingsSection>

          {/* Scheduler status bar — mirrors the artifact server status bar
              for visual consistency. */}
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border p-4 transition-colors",
              isSchedulerRunning
                ? "border-dls-border bg-dls-surface"
                : "border-amber-900/40 bg-amber-950/20",
            )}
            data-testid="scheduled-status-bar"
          >
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "inline-block size-2.5 rounded-full",
                  isSchedulerRunning
                    ? "bg-green-500 shadow-[0_0_8px_#22c55e66]"
                    : "bg-amber-500 shadow-[0_0_8px_#f59e0b66]",
                )}
              />
              {isSchedulerRunning ? (
                <CheckCircle2 className="size-4 text-green-600" />
              ) : (
                <XCircle className="size-4 text-amber-500" />
              )}
              <span className={isSchedulerRunning ? "text-foreground" : "text-amber-100"}>
                {isSchedulerRunning
                  ? t("settings.scheduled_health_running")
                  : t("settings.scheduled_health_offline")}
              </span>
              {healthQuery.data?.inflight ? (
                <Badge variant="outline" className="ml-1 gap-1 text-[10px]">
                  <Loader2 className="size-3 animate-spin" />
                  in-flight
                </Badge>
              ) : null}
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              {isSchedulerRunning ? (
                <span className="hidden @md/scheduled-stats:inline">jobs in this workspace run on this scheduler</span>
              ) : (
                <span className="hidden @md/scheduled-stats:inline max-w-md text-right">
                  {t("settings.scheduled_health_offline_hint")}
                </span>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="@container/scheduled-stats grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard icon={CalendarClock} label="Total tasks" value={stats.total} />
            <StatCard icon={Power} label="Enabled" value={stats.enabled} tone="green" />
            <StatCard icon={Pause} label="Disabled" value={stats.disabled} tone="muted" />
            <StatCard
              icon={XCircle}
              label="Failed (24h)"
              value={stats.failedLast24h}
              tone={stats.failedLast24h > 0 ? "red" : "muted"}
            />
          </div>

          {/* Search + filter */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("settings.scheduled_search_placeholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                className="pl-9"
                data-testid="scheduled-search"
              />
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-md border border-dls-border bg-dls-surface p-0.5">
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
                {t("settings.scheduled_filter_all")}
              </FilterChip>
              <FilterChip active={filter === "enabled"} onClick={() => setFilter("enabled")}>
                {t("settings.scheduled_filter_enabled")}
              </FilterChip>
              <FilterChip active={filter === "disabled"} onClick={() => setFilter("disabled")}>
                {t("settings.scheduled_filter_disabled")}
              </FilterChip>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {filteredJobs.length}/{jobs.length}
            </span>
          </div>
        </>
      ) : null}

      {/* Content */}
      {!enabled ? (
        <SettingsNotice>{t("settings.scheduled_requires_server")}</SettingsNotice>
      ) : jobsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-dls-secondary" data-testid="scheduled-loading">
          <Loader2 className="size-3.5 animate-spin" />
          {t("settings.scheduled_loading")}
        </div>
      ) : jobsQuery.isError ? (
        <SettingsNotice tone="error">
          {t("settings.scheduled_load_failed", {
            message: jobsQuery.error instanceof Error ? jobsQuery.error.message : String(jobsQuery.error),
          })}
        </SettingsNotice>
      ) : jobs.length === 0 ? (
        <Empty data-testid="scheduled-empty" className="border border-dashed border-dls-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock className="size-5" />
            </EmptyMedia>
            <EmptyTitle>{t("settings.scheduled_empty_title")}</EmptyTitle>
            <EmptyDescription>{t("settings.scheduled_empty_description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              size="sm"
              onClick={openNewDialog}
              className="gap-1.5"
              disabled={!isSchedulerRunning}
            >
              <Plus className="size-4" />
              {t("settings.scheduled_empty_create_button")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : filteredJobs.length === 0 ? (
        <SettingsInset className="flex flex-col items-center gap-3 py-12 text-center">
          <Search className="size-12 text-muted-foreground/40" />
          <div className="text-sm font-medium text-muted-foreground">{t("settings.scheduled_no_runs_match")}</div>
        </SettingsInset>
      ) : (
        <div className="overflow-hidden rounded-lg border border-dls-border" data-testid="scheduled-list">
          <ul className="divide-y divide-dls-border">
            {filteredJobs.map((job) => {
              const lastRun = findLatestRunForJob(runsQuery.data ?? [], job.id);
              return (
                <li
                  key={job.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                  data-testid={`scheduled-row-${job.id}`}
                >
                  <button
                    type="button"
                    onClick={() => openDrawer(job)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    data-testid={`scheduled-row-button-${job.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-dls-text">
                        {job.name}
                      </span>
                      <RunStatusBadge status={lastRun?.status ?? null} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-dls-secondary">
                      <span className="font-mono">{job.cronExpression}</span>
                      <span>·</span>
                      <span>{job.timezone}</span>
                      <span>·</span>
                      <span>{job.agent}</span>
                      <span>·</span>
                      <span className="truncate">
                        {modelsQuery.data?.models?.find((m) => m.value === job.model)?.label
                          ?? job.model
                          ?? t("settings.scheduled_model_default_badge")}
                      </span>
                      {job.nextRunAt ? (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Clock className="size-3" />
                            {formatRelativeTime(job.nextRunAt, now)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => openEditDialog(job)}
                    className="text-dls-secondary"
                    title={t("settings.scheduled_edit_button_aria")}
                    aria-label={t("settings.scheduled_edit_button_aria")}
                    data-testid={`scheduled-edit-${job.id}`}
                  >
                    {t("settings.scheduled_edit_button_short")}
                  </Button>
<Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => deleteMutation.mutate(job.id)}
                  disabled={deleteMutation.isPending}
                  className="text-destructive opacity-60 hover:opacity-100"
                  title="Delete"
                  aria-label="Delete scheduled task"
                  data-testid={`scheduled-delete-${job.id}`}
                >
                  <Trash2 className="size-3" />
                  Delete
                </Button>
                  <Switch
                    checked={job.enabled}
                    disabled={toggleMutation.isPending || !isSchedulerRunning}
                    onCheckedChange={(next) =>
                      toggleMutation.mutate({ jobId: job.id, enabled: next })
                    }
                    aria-label={t("settings.scheduled_toggle_aria", { name: job.name })}
                    data-testid={`scheduled-toggle-${job.id}`}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ScheduledTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        openworkServerClient={props.openworkServerClient}
        selectedWorkspaceId={props.selectedWorkspaceId}
        initialJob={dialogJob}
        workspaces={props.workspaces ?? []}
        onSuccess={() => {
          /* Toast + list refresh already handled in the dialog. */
        }}
      />

      <ScheduledTaskDetailDrawer
        open={drawerJob !== null}
        onOpenChange={(next) => {
          if (!next) setDrawerJob(null);
        }}
        openworkServerClient={props.openworkServerClient}
        selectedWorkspaceId={props.selectedWorkspaceId}
        job={drawerJob}
        onOpenSession={props.onOpenSession}
        onDeleted={(jobId) => {
          setDrawerJob(null);
          queryClient.removeQueries({ queryKey: ["scheduled-job-runs", jobId] });
        }}
      />
    </LayoutStack>
  );
}

/* ---------- helpers ---------- */

function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof CalendarClock;
  label: string;
  value: number;
  tone?: "default" | "green" | "red" | "muted";
}) {
  const toneClass = {
    default: "text-foreground",
    green: "text-green-11",
    red: "text-red-11",
    muted: "text-dls-secondary",
  }[tone];
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dls-border bg-dls-surface p-3">
      <Icon className={cn("size-4", tone === "muted" && "text-muted-foreground")} />
      <span className={cn("text-lg font-bold", toneClass)}>{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-dls-hover text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      data-testid={`scheduled-filter-${String(children).toLowerCase()}`}
    >
      {children}
    </button>
  );
}

function RunStatusBadge({ status }: { status: OpenworkScheduledRun["status"] | null }) {
  if (!status) {
    return (
      <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0 text-muted-foreground">
        no runs
      </Badge>
    );
  }
  const tone: Record<OpenworkScheduledRun["status"], string> = {
    pending: "text-dls-secondary",
    running: "text-sky-11",
    success: "text-green-11",
    failed: "text-red-11",
    skipped: "text-amber-11",
    skipped_overlap: "text-amber-11",
  };
  return (
    <Badge variant="outline" className={cn("shrink-0 text-[10px] px-1.5 py-0", tone[status])}>
      {status}
    </Badge>
  );
}

function findLatestRunForJob(
  groups: Array<{ jobId: string; runs: OpenworkScheduledRun[] }>,
  jobId: string,
): OpenworkScheduledRun | null {
  const group = groups.find((g) => g.jobId === jobId);
  if (!group) return null;
  return group.runs[0] ?? null;
}

function formatRelativeTime(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  if (Math.abs(diff) < 60_000) {
    return diff < 0 ? "now" : "in <1m";
  }
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 60) {
    return diff < 0 ? `${Math.abs(minutes)}m ago` : `in ${minutes}m`;
  }
  const hours = Math.round(diff / 3_600_000);
  if (Math.abs(hours) < 24) {
    return diff < 0 ? `${Math.abs(hours)}h ago` : `in ${hours}h`;
  }
  const days = Math.round(diff / 86_400_000);
  return diff < 0 ? `${Math.abs(days)}d ago` : `in ${days}d`;
}