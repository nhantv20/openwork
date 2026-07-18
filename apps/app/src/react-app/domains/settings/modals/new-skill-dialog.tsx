/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { FilePlus2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";

import { buildNewSkillTemplate } from "../panels/skill-detail-utils";

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export type NewSkillDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names that already exist in the workspace — used to validate uniqueness. */
  existingNames: string[];
  /** Reserved path prefixes that the engine manages. */
  reservedNames?: string[];
  onCreate: (input: { name: string; content: string; description: string }) => Promise<void> | void;
};

export function NewSkillDialog(props: NewSkillDialogProps) {
  const { open, onOpenChange, existingNames, reservedNames = [], onCreate } = props;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const reserved = useMemo(
    () => new Set([...existingNames.map((value) => value.toLowerCase()), ...reservedNames.map((value) => value.toLowerCase())]),
    [existingNames, reservedNames],
  );

  const trimmedName = name.trim();
  const isNameValid =
    trimmedName.length > 0 &&
    SKILL_NAME_PATTERN.test(trimmedName) &&
    !reserved.has(trimmedName.toLowerCase());

  const preview = useMemo(() => {
    if (!isNameValid) return "";
    return buildNewSkillTemplate(trimmedName, description.trim() || `TODO: describe what ${trimmedName} does.`);
  }, [trimmedName, description, isNameValid]);

  const handleSubmit = async () => {
    if (!isNameValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await Promise.resolve(onCreate({ name: trimmedName, content: preview, description: description.trim() }));
      toast.success(t("skills.new_dialog_created", undefined, { name: trimmedName }));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.something_went_wrong"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] min-h-0 w-full max-w-3xl flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
              <FilePlus2 className="size-5 text-dls-secondary" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle>{t("skills.new_dialog_title")}</DialogTitle>
              <DialogDescription>{t("skills.new_dialog_desc")}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-dls-secondary">{t("skills.new_dialog_name_label")}</span>
              <Input
                autoFocus
                placeholder="my-new-skill"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                spellCheck={false}
                aria-invalid={trimmedName.length > 0 && !isNameValid}
              />
              <FieldHelp
                visible={trimmedName.length > 0}
                valid={isNameValid}
                invalidText={
                  reserved.has(trimmedName.toLowerCase())
                    ? t("skills.new_dialog_name_taken")
                    : t("skills.new_dialog_name_invalid")
                }
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-dls-secondary">
                {t("skills.new_dialog_description_label")}
              </span>
              <Textarea
                rows={4}
                placeholder={t("skills.new_dialog_description_placeholder")}
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
              <span className="text-[11px] text-dls-secondary">{t("skills.new_dialog_description_hint")}</span>
            </label>

            {error ? (
              <div className="rounded-xl border border-red-7/20 bg-red-1/40 px-3 py-2 text-xs text-red-12">{error}</div>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col rounded-2xl border border-dls-border bg-dls-surface">
            <div className="flex items-center justify-between border-b border-dls-border px-4 py-2.5">
              <span className="text-xs font-medium text-dls-secondary">{t("skills.new_dialog_preview_label")}</span>
              <span className="text-[11px] text-dls-secondary">
                {t("skills.new_dialog_preview_path", undefined, { name: trimmedName || "my-skill" })}
              </span>
            </div>
            <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] text-dls-text">
              {preview || t("skills.new_dialog_preview_empty")}
            </pre>
          </div>
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="ghost" type="button" disabled={submitting}>
                {t("common.cancel")}
              </Button>
            }
          />
          <Button type="button" onClick={() => void handleSubmit()} disabled={!isNameValid || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
            {t("skills.new_dialog_create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldHelp(props: { visible: boolean; valid: boolean; invalidText: string }) {
  if (!props.visible) {
    return <span className="text-[11px] text-dls-secondary">{t("skills.new_dialog_name_hint")}</span>;
  }
  if (props.valid) {
    return <span className="text-[11px] text-emerald-11">{t("skills.new_dialog_name_ok")}</span>;
  }
  return <span className="text-[11px] text-amber-11">{props.invalidText}</span>;
}