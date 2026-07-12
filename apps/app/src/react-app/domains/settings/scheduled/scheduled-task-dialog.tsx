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
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  OpenworkScheduledAgent,
  OpenworkScheduledJob,
  OpenworkServerClient,
} from "@/app/lib/openwork-server";
import { OPENWORK_SCHEDULED_AGENTS } from "@/app/lib/openwork-server";
import {
  COMMON_TIMEZONES,
  CRON_CHIPS,
  DEFAULT_TIMEZONE,
  formatNextRun,
  validateCron,
} from "./cron-helpers";

/** Server-side default for `agent`. Kept in sync with the
 *  `DEFAULT_AGENT` constant in `apps/server/src/routes/scheduled.ts`. */
const DEFAULT_AGENT: OpenworkScheduledAgent = "build";

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
  const [agent, setAgent] = useState<OpenworkScheduledAgent>(
    (props.initialJob?.agent as OpenworkScheduledAgent | undefined) ?? DEFAULT_AGENT,
  );
  // `""` means "use the workspace default model" (server stores null).
  // We keep it as a string for the <Select> binding and translate to
  // null on submit. The server may also seed it with the workspace
  // default once the catalog loads.
  const [model, setModel] = useState<string>(props.initialJob?.model ?? "");

  // Reset local state whenever the dialog re-opens for a different job.
  useEffect(() => {
    setName(props.initialJob?.name ?? "");
    setPrompt(props.initialJob?.prompt ?? "");
    setCron(props.initialJob?.cronExpression ?? "0 9 * * *");
    setTimezone(props.initialJob?.timezone ?? DEFAULT_TIMEZONE);
    setAgent((props.initialJob?.agent as OpenworkScheduledAgent | undefined) ?? DEFAULT_AGENT);
    setModel(props.initialJob?.model ?? "");
  }, [props.initialJob?.id, props.open]);

  // Fetch the workspace's model catalog so the user can pick the
  // right LLM for the job. Best-effort — when the engine is offline
  // or doesn't expose providers we just show no options and the user
  // keeps the default.
  const modelsQuery = useQuery({
    queryKey: ["scheduled-models", props.selectedWorkspaceId],
    enabled: props.open && Boolean(props.openworkServerClient) && Boolean(props.selectedWorkspaceId),
    queryFn: async () => {
      if (!props.openworkServerClient) {
        throw new Error("OpenWork server is not connected");
      }
      return props.openworkServerClient.listScheduledModels(props.selectedWorkspaceId);
    },
  });

  const cronValidation = useMemo(() => validateCron(cron, timezone), [cron, timezone]);

  const isEdit = Boolean(props.initialJob);

  // Auto-pick the workspace default model the first time the catalog
  // resolves for a fresh create-form. Editing an existing job keeps
  // the stored value (or "" if the user explicitly cleared it).
  const hasAutoPickedRef = useRef(false);
  useEffect(() => {
    if (hasAutoPickedRef.current) return;
    if (isEdit) {
      hasAutoPickedRef.current = true;
      return;
    }
    const data = modelsQuery.data;
    if (!data) return;
    if (data.defaultModel) {
      setModel(data.defaultModel);
    } else if (data.models.length > 0) {
      const first = data.models[0];
      if (first) setModel(first.value);
    }
    hasAutoPickedRef.current = true;
  }, [modelsQuery.data, isEdit]);

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
          agent,
          // Empty string in the UI = "use the workspace default model".
          // The server treats `model: null` as "clear" and a string as
          // "set", so we forward the user's pick verbatim.
          model: model || null,
        });
        return result.job;
      }
      const result = await props.openworkServerClient.createScheduledJob({
        workspaceId: props.selectedWorkspaceId,
        name: name.trim(),
        prompt,
        cron: cron.trim(),
        timezone,
        agent,
        model: model || null,
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

          <Field>
            <FieldLabel htmlFor="scheduled-dialog-agent">
              {t("settings.scheduled_field_agent")}
            </FieldLabel>
            <Select
              value={agent}
              onValueChange={(value) => {
                if (value && (OPENWORK_SCHEDULED_AGENTS as readonly string[]).includes(value)) {
                  setAgent(value as OpenworkScheduledAgent);
                }
              }}
            >
              <SelectTrigger id="scheduled-dialog-agent" data-testid="scheduled-dialog-agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPENWORK_SCHEDULED_AGENTS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {t(`settings.scheduled_agent_${a}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {t("settings.scheduled_field_agent_description")}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="scheduled-dialog-model">
              {t("settings.scheduled_field_model")}
            </FieldLabel>
            <Select value={model} onValueChange={(value) => setModel(value ?? "")}>
              <SelectTrigger id="scheduled-dialog-model" data-testid="scheduled-dialog-model">
                <SelectValue placeholder={t("settings.scheduled_model_default_placeholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">
                  {t("settings.scheduled_model_default_option")}
                </SelectItem>
                {(modelsQuery.data?.models ?? []).map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                    {m.providerLabel ? ` · ${m.providerLabel}` : ""}
                    {m.isDefault ? ` · ${t("settings.scheduled_model_default_badge")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {t("settings.scheduled_field_model_description")}
            </FieldDescription>
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
