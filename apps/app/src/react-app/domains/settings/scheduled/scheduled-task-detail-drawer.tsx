/**
 * Detail drawer for a scheduled task (Phase 3 / M2 / S6).
 *
 * Shows the most recent runs of a job (status, scheduled/started/finished
 * timestamps, session link if any, error message if failed). Lets the
 * user trigger a manual run from here, and delete the job.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { t } from "@/i18n";
import type {
  OpenworkScheduledJob,
  OpenworkScheduledRun,
  OpenworkServerClient,
} from "@/app/lib/openwork-server";

export type ScheduledTaskDetailDrawerProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  openworkServerClient: OpenworkServerClient | null;
  selectedWorkspaceId: string;
  job: OpenworkScheduledJob | null;
  /** Called when the user clicks a session link, so the parent can
   *  navigate to the session. Optional. */
  onOpenSession?: (sessionId: string) => void;
  /** Called when the user deletes the job, so the parent can clear
   *  the selection. Optional. */
  onDeleted?: (jobId: string) => void;
};

const STATUS_LABEL_KEY: Record<OpenworkScheduledRun["status"], string> = {
  pending: "settings.scheduled_run_status_pending",
  running: "settings.scheduled_run_status_running",
  success: "settings.scheduled_run_status_success",
  failed: "settings.scheduled_run_status_failed",
  skipped: "settings.scheduled_run_status_skipped",
  skipped_overlap: "settings.scheduled_run_status_skipped_overlap",
};

const STATUS_TONE: Record<OpenworkScheduledRun["status"], string> = {
  pending: "text-dls-secondary",
  running: "text-sky-11",
  success: "text-green-11",
  failed: "text-red-11",
  skipped: "text-amber-11",
  skipped_overlap: "text-amber-11",
};

function formatTimestamp(ms: number | null): string {
  if (ms === null) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function ScheduledTaskDetailDrawer(props: ScheduledTaskDetailDrawerProps) {
  const queryClient = useQueryClient();
  const enabled = Boolean(props.openworkServerClient) && Boolean(props.job);

  const runsQuery = useQuery({
    queryKey: ["scheduled-job-runs", props.job?.id],
    enabled,
    queryFn: async () => {
      if (!props.openworkServerClient || !props.job) return [];
      const result = await props.openworkServerClient.listScheduledJobRuns(props.job.id, { limit: 20 });
      return result.runs;
    },
  });

  const runNowMutation = useMutation({
    mutationFn: async () => {
      if (!props.openworkServerClient || !props.job) {
        throw new Error("Job is not loaded");
      }
      const result = await props.openworkServerClient.runScheduledJob(props.job.id);
      return result.run;
    },
    onSuccess: (run) => {
      toast(t("settings.scheduled_run_triggered"), {
        description: `${run.status}`,
      });
      queryClient.invalidateQueries({ queryKey: ["scheduled-job-runs", props.job?.id] });
    },
    onError: (err) => {
      toast(t("settings.scheduled_run_failed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!props.openworkServerClient || !props.job) {
        throw new Error("Job is not loaded");
      }
      await props.openworkServerClient.deleteScheduledJob(props.job.id);
    },
    onSuccess: () => {
      toast(t("settings.scheduled_delete_succeeded"));
      if (props.job) {
        queryClient.invalidateQueries({ queryKey: ["scheduled-jobs", props.selectedWorkspaceId] });
        props.onDeleted?.(props.job.id);
      }
      props.onOpenChange(false);
    },
    onError: (err) => {
      toast(t("settings.scheduled_delete_failed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  if (!props.job) return null;

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md gap-0"
        data-testid="scheduled-detail-drawer"
      >
        <SheetHeader>
          <SheetTitle>{props.job.name}</SheetTitle>
          <SheetDescription>
            <span className="font-mono text-[12px]">
              {props.job.cronExpression} · {props.job.timezone}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => runNowMutation.mutate()}
              disabled={runNowMutation.isPending || !props.openworkServerClient}
              className="gap-1.5"
              data-testid="scheduled-detail-run-now"
            >
              {runNowMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {t("settings.scheduled_run_now")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending || !props.openworkServerClient}
              className="gap-1.5 text-destructive"
              data-testid="scheduled-detail-delete"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {t("common.delete")}
            </Button>
          </div>

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">
              {t("settings.scheduled_recent_runs")}
            </h3>
            {runsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-[12px] text-dls-secondary">
                <Loader2 className="size-3.5 animate-spin" />
                {t("settings.scheduled_loading")}
              </div>
            ) : runsQuery.isError ? (
              <p className="text-[12px] text-destructive">
                {runsQuery.error instanceof Error
                  ? runsQuery.error.message
                  : String(runsQuery.error)}
              </p>
            ) : (runsQuery.data ?? []).length === 0 ? (
              <p className="text-[12px] text-dls-secondary">
                {t("settings.scheduled_no_runs_yet")}
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="scheduled-detail-runs">
                {(runsQuery.data ?? []).map((run) => (
                  <li
                    key={run.id}
                    className="rounded-lg border border-dls-border bg-dls-surface p-2.5 text-[12px]"
                    data-testid={`scheduled-detail-run-${run.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-medium ${STATUS_TONE[run.status]}`}>
                        {t(STATUS_LABEL_KEY[run.status])}
                      </span>
                      <span className="text-dls-secondary">
                        {formatTimestamp(run.scheduledFor)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-dls-secondary">
                      {formatTimestamp(run.startedAt)} → {formatTimestamp(run.finishedAt)}
                    </div>
                    {run.sessionId ? (
                      <button
                        type="button"
                        onClick={() => props.onOpenSession?.(run.sessionId as string)}
                        className="mt-1 text-[11px] text-accent-11 underline-offset-2 hover:underline"
                        disabled={!props.onOpenSession}
                      >
                        {t("settings.scheduled_open_session", { id: run.sessionId })}
                      </button>
                    ) : null}
                    {run.error ? (
                      <p className="mt-1 break-words text-[11px] text-destructive">
                        {run.error}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
