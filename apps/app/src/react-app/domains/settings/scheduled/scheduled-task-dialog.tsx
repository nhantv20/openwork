/**
 * Create / edit dialog for scheduled tasks (Phase 3 / M2 / S6).
 *
 * Form fields:
 * - Name (required, free text)
 * - Prompt (required, multi-line)
 * - Cron expression (required) with helper chips + "Next 3 runs" preview
 * - Timezone (required, select from COMMON_TIMEZONES)
 *
 * Used for both create and edit. The parent decides which one by
 * passing an optional `initialJob`. Validation happens client-side
 * via croner before submit; the server re-validates and returns 400
 * on cron error (defense in depth).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { t } from "@/i18n";
import type {
  OpenworkScheduledJob,
  OpenworkServerClient,
} from "@/app/lib/openwork-server";
import {
  COMMON_TIMEZONES,
  CRON_CHIPS,
  DEFAULT_TIMEZONE,
  formatNextRun,
  validateCron,
} from "./cron-helpers";

export type ScheduledTaskDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  openworkServerClient: OpenworkServerClient | null;
  selectedWorkspaceId: string;
  /** When set, the dialog edits this job. When null, the dialog creates a new one. */
  initialJob: OpenworkScheduledJob | null;
  /** Called after a successful create / update. */
  onSuccess: (job: OpenworkScheduledJob) => void;
};

export function ScheduledTaskDialog(props: ScheduledTaskDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(props.initialJob?.name ?? "");
  const [prompt, setPrompt] = useState(props.initialJob?.prompt ?? "");
  const [cron, setCron] = useState(props.initialJob?.cronExpression ?? "0 9 * * *");
  const [timezone, setTimezone] = useState<string>(
    props.initialJob?.timezone ?? DEFAULT_TIMEZONE,
  );

  // Reset local state whenever the dialog re-opens for a different job.
  useEffect(() => {
    setName(props.initialJob?.name ?? "");
    setPrompt(props.initialJob?.prompt ?? "");
    setCron(props.initialJob?.cronExpression ?? "0 9 * * *");
    setTimezone(props.initialJob?.timezone ?? DEFAULT_TIMEZONE);
  }, [props.initialJob?.id, props.open]);

  const cronValidation = useMemo(() => validateCron(cron, timezone), [cron, timezone]);

  const isEdit = Boolean(props.initialJob);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!props.openworkServerClient) {
        throw new Error("OpenWork server is not connected");
      }
      if (isEdit && props.initialJob) {
        const result = await props.openworkServerClient.updateScheduledJob(props.initialJob.id, {
          name: name.trim(),
          prompt,
          cron: cron.trim(),
          timezone,
        });
        return result.job;
      }
      const result = await props.openworkServerClient.createScheduledJob({
        workspaceId: props.selectedWorkspaceId,
        name: name.trim(),
        prompt,
        cron: cron.trim(),
        timezone,
      });
      return result.job;
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-jobs", props.selectedWorkspaceId] });
      queryClient.setQueryData<OpenworkScheduledJob[]>(
        ["scheduled-jobs", props.selectedWorkspaceId],
        (current) => {
          if (isEdit) {
            return current?.map((j) => (j.id === job.id ? job : j)) ?? [job];
          }
          return [job, ...(current ?? [])];
        },
      );
      toast(isEdit ? t("settings.scheduled_edit_saved") : t("settings.scheduled_create_saved"), {
        description: job.name,
      });
      props.onSuccess(job);
      props.onOpenChange(false);
    },
    onError: (err) => {
      toast(t("settings.scheduled_save_failed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const canSubmit =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    cron.trim().length > 0 &&
    cronValidation.ok &&
    !mutation.isPending;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="scheduled-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <CalendarClock className="size-5 text-dls-secondary" />
            <DialogTitle>
              {isEdit
                ? t("settings.scheduled_dialog_title_edit")
                : t("settings.scheduled_dialog_title_new")}
            </DialogTitle>
          </div>
          <DialogDescription>
            {t("settings.scheduled_dialog_description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="scheduled-dialog-name">
              {t("settings.scheduled_field_name")}
            </FieldLabel>
            <Input
              id="scheduled-dialog-name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder={t("settings.scheduled_field_name_placeholder")}
              data-testid="scheduled-dialog-name"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="scheduled-dialog-prompt">
              {t("settings.scheduled_field_prompt")}
            </FieldLabel>
            <Textarea
              id="scheduled-dialog-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.currentTarget.value)}
              rows={4}
              placeholder={t("settings.scheduled_field_prompt_placeholder")}
              data-testid="scheduled-dialog-prompt"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="scheduled-dialog-cron">
              {t("settings.scheduled_field_cron")}
            </FieldLabel>
            <Input
              id="scheduled-dialog-cron"
              value={cron}
              onChange={(e) => setCron(e.currentTarget.value)}
              placeholder="0 9 * * 1-5"
              className="font-mono"
              data-testid="scheduled-dialog-cron"
            />
            <FieldDescription>
              <div className="flex flex-wrap gap-1.5">
                {CRON_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setCron(chip.expression)}
                    className="rounded-full border border-dls-border bg-dls-surface px-2.5 py-0.5 text-[11px] text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
                    data-testid={`scheduled-chip-${chip.id}`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </FieldDescription>
            {cronValidation.ok ? (
              <ul
                className="mt-2 space-y-0.5 text-[11px] text-dls-secondary"
                data-testid="scheduled-dialog-next-runs"
              >
                {cronValidation.nextRuns.map((d, i) => (
                  <li key={i}>
                    {t("settings.scheduled_next_run", { when: formatNextRun(d, timezone) })}
                  </li>
                ))}
              </ul>
            ) : (
              <p
                className="mt-2 text-[11px] text-destructive"
                role="alert"
                data-testid="scheduled-dialog-cron-error"
              >
                {cronValidation.error}
              </p>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="scheduled-dialog-timezone">
              {t("settings.scheduled_field_timezone")}
            </FieldLabel>
            <Select value={timezone} onValueChange={(value) => setTimezone(value ?? DEFAULT_TIMEZONE)}>
              <SelectTrigger id="scheduled-dialog-timezone" data-testid="scheduled-dialog-timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => props.onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
            data-testid="scheduled-dialog-submit"
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {isEdit ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
