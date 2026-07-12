/**
 * Scheduled tasks settings view (Phase 3 / M2 / S5 + S6).
 *
 * Lists cron jobs for the current workspace. Per plan §3.6:
 * - Toggle enable/disable inline (Switch).
 * - "New task" button opens the create dialog.
 * - Row click opens the detail drawer (run history + Run now / Delete).
 * - Empty / loading / error / requires-server states for graceful
 *   failure modes.
 *
 * The Quick Actions group button in the sidebar (`onOpenScheduled`)
 * still toasts in this slice — wiring it to actual navigation
 * requires touching the top-level shell route, which the user
 * can verify in-app and we'll rewire in a follow-up if desired.
 */
import { useState } from "react";
import { CalendarClock, Loader2, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
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
  OpenworkServerClient,
} from "@/app/lib/openwork-server";
import { ScheduledTaskDialog } from "./scheduled-task-dialog";
import { ScheduledTaskDetailDrawer } from "./scheduled-task-detail-drawer";

export type ScheduledTasksViewProps = {
  openworkServerClient: OpenworkServerClient | null;
  selectedWorkspaceId: string;
  /** Optional: navigate to a session from the detail drawer. */
  onOpenSession?: (sessionId: string) => void;
};

export function ScheduledTasksView(props: ScheduledTasksViewProps) {
  const queryClient = useQueryClient();
  const enabled = Boolean(props.openworkServerClient) && Boolean(props.selectedWorkspaceId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogJob, setDialogJob] = useState<OpenworkScheduledJob | null>(null);
  const [drawerJob, setDrawerJob] = useState<OpenworkScheduledJob | null>(null);

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

  return (
    <LayoutStack>
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
            <Button
              type="button"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={openNewDialog}
              disabled={!enabled}
              data-testid="scheduled-new-button"
            >
              <Plus className="size-4" />
              {t("settings.scheduled_new_button")}
            </Button>
          </div>
        </SettingsSectionHeader>

        {!enabled ? (
          <SettingsNotice>
            {t("settings.scheduled_requires_server")}
          </SettingsNotice>
        ) : jobsQuery.isLoading ? (
          <div
            className="flex items-center gap-2 text-[12px] text-dls-secondary"
            data-testid="scheduled-loading"
          >
            <Loader2 className="size-3.5 animate-spin" />
            {t("settings.scheduled_loading")}
          </div>
        ) : jobsQuery.isError ? (
          <SettingsNotice tone="error">
            {t("settings.scheduled_load_failed", {
              message: jobsQuery.error instanceof Error ? jobsQuery.error.message : String(jobsQuery.error),
            })}
          </SettingsNotice>
        ) : jobsQuery.data && jobsQuery.data.length === 0 ? (
          <Empty data-testid="scheduled-empty" className="border border-dashed border-dls-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarClock className="size-5" />
              </EmptyMedia>
              <EmptyTitle>{t("settings.scheduled_empty_title")}</EmptyTitle>
              <EmptyDescription>{t("settings.scheduled_empty_description")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" size="sm" onClick={openNewDialog} className="gap-1.5">
                <Plus className="size-4" />
                {t("settings.scheduled_empty_create_button")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-dls-border" data-testid="scheduled-list">
            <ul className="divide-y divide-dls-border">
              {(jobsQuery.data ?? []).map((job) => (
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
                    <div className="truncate text-[13px] font-medium text-dls-text">
                      {job.name}
                    </div>
                    <div className="truncate font-mono text-[11px] text-dls-secondary">
                      {job.cronExpression} · {job.timezone} · {job.agent}
                    </div>
                  </button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => openEditDialog(job)}
                    className="text-dls-secondary"
                    title={t("settings.scheduled_edit_button_aria")}
                    aria-label={t("settings.scheduled_edit_button_aria")}
                    data-testid={`scheduled-edit-${job.id}`}
                  >
                    {t("settings.scheduled_edit_button_short")}
                  </Button>
                  <Switch
                    checked={job.enabled}
                    disabled={toggleMutation.isPending}
                    onCheckedChange={(next) =>
                      toggleMutation.mutate({ jobId: job.id, enabled: next })
                    }
                    aria-label={t("settings.scheduled_toggle_aria", { name: job.name })}
                    data-testid={`scheduled-toggle-${job.id}`}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </SettingsSection>

      <ScheduledTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        openworkServerClient={props.openworkServerClient}
        selectedWorkspaceId={props.selectedWorkspaceId}
        initialJob={dialogJob}
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
          // Drop the now-stale cached entry.
          queryClient.removeQueries({ queryKey: ["scheduled-job-runs", jobId] });
        }}
      />
    </LayoutStack>
  );
}
