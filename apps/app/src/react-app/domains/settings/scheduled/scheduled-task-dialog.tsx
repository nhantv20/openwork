/**
 * Create / edit dialog for scheduled tasks (Phase 3 / M2 / S6).
 *
 * Form fields:
 * - Workspace (optional — only shown when the user has more than one
 *   so they can pick where the task runs)
 * - "Update artifact" quick-fill (optional — when an artifact is
 *   picked, the prompt is auto-seeded with "Hãy cập nhật artifact
 *   "<name>" với nội dung mới" so the user only has to fill in the
 *   actual changes before saving)
 * - Name (required, free text)
 * - Prompt (required, multi-line)
 * - Cron expression (required) with helper chips + "Next 3 runs" preview
 * - Timezone (required, select from COMMON_TIMEZONES)
 * - Agent + model
 *
 * Used for both create and edit. The parent decides which one by
 * passing an optional `initialJob`. Validation happens client-side
 * via croner before submit; the server re-validates and returns 400
 * on cron error (defense in depth).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarClock, Loader2, X } from "lucide-react";
import { toast } from "@/components/ui/sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  OpenworkWorkspaceInfo,
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

/** Artifacts we offer as a "Update artifact" quick-fill. Resolved
 *  via the existing artifact server (port 26316) — same surface the
 *  Settings → Artifacts page reads. We only need the artifact names;
 *  the prompt template embeds the name and asks the user to fill in
 *  the new content below. */
type ArtifactOption = {
  name: string;
  url: string;
};

async function fetchArtifactList(): Promise<ArtifactOption[]> {
  try {
    const resp = await fetch("http://127.0.0.1:26316/", { cache: "no-cache" });
    if (!resp.ok) return [];
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const items: ArtifactOption[] = [];
    doc.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href === "/") return;
      const name = decodeURIComponent(href.replace(/^\//, ""));
      if (name.endsWith(".meta.json")) return;
      if (name === "dashboard.html") return;
      items.push({
        name,
        url: `http://127.0.0.1:26316/${encodeURIComponent(name)}`,
      });
    });
    return items;
  } catch {
    return [];
  }
}

export type ScheduledTaskDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  openworkServerClient: OpenworkServerClient | null;
  selectedWorkspaceId: string;
  /** Optional list of workspaces so the user can pick where the task
   *  runs. Pass an empty array (the default) to hide the selector. */
  workspaces?: OpenworkWorkspaceInfo[];
  /** Called after a successful create / update. */
  onSuccess: (job: OpenworkScheduledJob) => void;
  /** Edit mode: when set, the dialog edits this job and the workspace
   *  selector is locked. */
  initialJob?: OpenworkScheduledJob | null;
};

export function ScheduledTaskDialog(props: ScheduledTaskDialogProps) {
  const queryClient = useQueryClient();
  const workspaces = props.workspaces ?? [];
  const showWorkspaceSelector = workspaces.length > 1 && !props.initialJob;
  const initialWorkspaceId = props.initialJob?.workspaceId ?? props.selectedWorkspaceId;
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
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
  // "Update artifact" quick-fill: when the user picks an artifact,
  // we seed both the task name and the prompt with the standard
  // "cập nhật artifact" template so they don't have to type it.
  const [artifactName, setArtifactName] = useState<string>("");

  // Reset local state whenever the dialog re-opens for a different job.
  useEffect(() => {
    setWorkspaceId(props.initialJob?.workspaceId ?? props.selectedWorkspaceId);
    setName(props.initialJob?.name ?? "");
    setPrompt(props.initialJob?.prompt ?? "");
    setCron(props.initialJob?.cronExpression ?? "0 9 * * *");
    setTimezone(props.initialJob?.timezone ?? DEFAULT_TIMEZONE);
    setAgent((props.initialJob?.agent as OpenworkScheduledAgent | undefined) ?? DEFAULT_AGENT);
    setModel(props.initialJob?.model ?? "");
    setArtifactName("");
  }, [props.initialJob?.id, props.open, props.selectedWorkspaceId]);

  // Fetch the workspace's model catalog so the user can pick the
  // right LLM for the job. Best-effort — when the engine is offline
  // or doesn't expose providers we just show no options and the user
  // keeps the default.
  const modelsQuery = useQuery({
    queryKey: ["scheduled-models", workspaceId],
    enabled: props.open && Boolean(props.openworkServerClient) && Boolean(workspaceId),
    queryFn: async () => {
      if (!props.openworkServerClient) {
        throw new Error("OpenWork server is not connected");
      }
      return props.openworkServerClient.listScheduledModels(workspaceId);
    },
  });

  // Artifacts are served by a sidecar (port 26316) independent of the
  // scheduler server. Fetched on first dialog open so the "Update
  // artifact" picker is populated.
  const artifactsQuery = useQuery({
    queryKey: ["scheduled-artifact-list"],
    enabled: props.open && !props.initialJob,
    queryFn: fetchArtifactList,
    staleTime: 30_000,
  });

  const cronValidation = useMemo(() => validateCron(cron, timezone), [cron, timezone]);

  const isEdit = Boolean(props.initialJob);

  // Auto-pick the workspace default model the first time the catalog
  // resolves for a fresh create-form. Editing an existing job keeps
  // the stored value (or "" if the user explicitly cleared it).
  // Reset the ref each time the dialog opens so a Cancel-then-New
  // flow still picks the default.
  const hasAutoPickedRef = useRef(false);
  useEffect(() => {
    if (!props.open) return;
    hasAutoPickedRef.current = false;
  }, [props.open, props.initialJob?.id]);
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
        workspaceId,
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
      // Invalidate every workspace's cache so the new job surfaces
      // regardless of which workspace the user switches to next.
      queryClient.invalidateQueries({ queryKey: ["scheduled-jobs"] });
      queryClient.setQueryData<OpenworkScheduledJob[]>(
        ["scheduled-jobs", workspaceId],
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
      <DialogContent
        className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0"
        data-testid="scheduled-dialog"
      >
        <DialogHeader className="shrink-0 border-b border-dls-border px-6 py-4">
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* Workspace selector — only when the user has more than one
              workspace AND they're creating a new job (edit mode is
              locked to the original workspace). */}
          {showWorkspaceSelector ? (
            <Field>
              <FieldLabel htmlFor="scheduled-dialog-workspace">
                Workspace
              </FieldLabel>
              <Select value={workspaceId} onValueChange={(value) => value && setWorkspaceId(value)}>
                <SelectTrigger id="scheduled-dialog-workspace" data-testid="scheduled-dialog-workspace">
                  <SelectValue placeholder="Select a workspace…" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id}>
                      {ws.displayName?.trim() || ws.openworkWorkspaceName?.trim() || ws.name?.trim() || ws.path?.trim() || ws.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                The task runs in the selected workspace's context and uses its default model if you don't override it below.
              </FieldDescription>
            </Field>
          ) : null}

          {/* "Update artifact" quick-fill — only on create. Reads from
              the artifact sidecar (port 26316) and seeds the prompt
              with the standard template the agent uses to refresh an
              existing artifact. The user can still edit everything. */}
          {!isEdit ? (
            <Field>
              <FieldLabel htmlFor="scheduled-dialog-artifact">
                Update artifact (optional)
              </FieldLabel>
              <div className="flex items-center gap-2">
                <Select
                  value={artifactName || "__none__"}
                  onValueChange={(value) => {
                    const picked = value ?? "";
                    if (picked === "__none__") {
                      // "None" clears the artifact selection AND resets
                      // the seeded name + prompt so the user starts
                      // from a blank form when they change their mind.
                      setArtifactName("");
                      setName("");
                      setPrompt("");
                      return;
                    }
                    setArtifactName(picked);
                    const artifactTemplatePrompt = `Hãy cập nhật artifact "${picked}" với nội dung mới.`;
                    // Always seed name and prompt when user explicitly picks an artifact.
                    setPrompt(artifactTemplatePrompt);
                    setName(`Update ${picked}`);
                  }}
                >
                  <SelectTrigger id="scheduled-dialog-artifact" data-testid="scheduled-dialog-artifact">
                    <SelectValue placeholder="Pick an artifact to update…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">(none)</span>
                    </SelectItem>
                    {artifactsQuery.isLoading ? (
                      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        Loading artifacts…
                      </div>
                    ) : (artifactsQuery.data ?? []).length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        No artifacts available. Publish one from a chat first.
                      </div>
                    ) : (
                      (artifactsQuery.data ?? []).map((a) => (
                        <SelectItem key={a.name} value={a.name}>
                          <span className="flex items-center gap-2">
                            <Archive className="size-3 text-muted-foreground" />
                            <span className="truncate">{a.name}</span>
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {artifactName ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      setArtifactName("");
                      // Don't clear name/prompt — user might still want them.
                    }}
                    title="Clear selection"
                    aria-label="Clear artifact selection"
                  >
                    <X className="size-3.5" />
                  </Button>
                ) : null}
              </div>
              {artifactName ? (
                <p className="text-xs text-muted-foreground">
                  Prompt seeded with the standard "cập nhật artifact" template. Edit below to add the new content.
                </p>
              ) : (
                <FieldDescription>
                  Pre-fill the prompt with a template for refreshing an existing artifact. Standalone artifacts appear here if the artifact server is running.
                </FieldDescription>
              )}
            </Field>
          ) : null}

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
            <Select
              value={model || "__default__"}
              onValueChange={(value) => setModel(value === "__default__" ? "" : value ?? "")}
            >
              <SelectTrigger id="scheduled-dialog-model" data-testid="scheduled-dialog-model">
                <SelectValue placeholder={t("settings.scheduled_model_default_placeholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">
                  {t("settings.scheduled_model_default_option")}
                </SelectItem>
                {modelsQuery.isLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Loading models…
                  </div>
                ) : modelsQuery.isError ? (
                  <div className="px-3 py-2 text-xs text-destructive">
                    {modelsQuery.error instanceof Error
                      ? modelsQuery.error.message
                      : "Failed to load models"}
                  </div>
                ) : (modelsQuery.data?.models ?? []).length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No models configured in this workspace. Open Settings → AI Providers.
                  </div>
                ) : (
                  (modelsQuery.data?.models ?? []).map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="flex items-center gap-2">
                        <span className="truncate">{m.label}</span>
                        {m.providerLabel ? (
                          <span className="text-xs text-muted-foreground">· {m.providerLabel}</span>
                        ) : null}
                        {m.isDefault ? (
                          <Badge variant="outline" className="ml-1 shrink-0 text-[10px] px-1.5 py-0">
                            {t("settings.scheduled_model_default_badge")}
                          </Badge>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <FieldDescription>
              {t("settings.scheduled_field_model_description")}
            </FieldDescription>
          </Field>
        </div>

        <DialogFooter className="mb-0 shrink-0 gap-2 border-t border-dls-border bg-dls-surface/40 px-6 py-3 sm:flex-row sm:justify-end">
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
