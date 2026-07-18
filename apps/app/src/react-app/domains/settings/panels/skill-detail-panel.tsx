/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import {
  Blocks,
  Cable,
  Eye,
  FileText,
  Folder,
  KeyRound,
  Loader2,
  Lock,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { MarkdownBlock } from "@/components/markdown/markdown";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

import type { SkillCard } from "@/app/types";
import {
  describeSkillScope,
  extractToolReferences,
  parseSkillFrontmatter,
  type SkillFrontmatter,
  type SkillToolReference,
} from "./skill-detail-utils";

export type SkillDetailPanelProps = {
  skill: SkillCard | null;
  onClose: () => void;
  busy?: boolean;
  /**
   * Read-only mode is forced for global skills. The OpenWork server has no
   * create/update/delete endpoint for them, so we don't expose edit/save.
   */
  readOnly?: boolean;
  readSkill: (name: string) => Promise<{ content: string } | null>;
  saveSkill: (input: {
    name: string;
    content: string;
    description?: string;
  }) => void | Promise<void>;
};

type DetailStatus =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; content: string; frontmatter: SkillFrontmatter; body: string; tools: SkillToolReference[] };

const tabTriggerClass =
  "gap-2 data-[selected]:bg-dls-hover data-[selected]:text-foreground text-dls-secondary";

export function SkillDetailPanel(props: SkillDetailPanelProps) {
  const { skill } = props;
  const [status, setStatus] = useState<DetailStatus>({ kind: "loading" });
  const [draft, setDraft] = useState("");
  const [savedDraft, setSavedDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("content");

  const isReadOnly = Boolean(props.readOnly) || skill?.scope === "global";

  useEffect(() => {
    if (!skill) return;
    setStatus({ kind: "loading" });
    setActiveTab("content");
    let cancelled = false;
    props
      .readSkill(skill.name)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setStatus({ kind: "error", message: t("skills.detail_load_failed") });
          return;
        }
        const { frontmatter, body } = parseSkillFrontmatter(result.content);
        const tools = extractToolReferences(body);
        setStatus({
          kind: "ready",
          content: result.content,
          frontmatter,
          body,
          tools,
        });
        setDraft(result.content);
        setSavedDraft(result.content);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : t("common.something_went_wrong");
        setStatus({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [skill, props]);

  const isDirty = draft !== savedDraft;

  const handleSave = async () => {
    if (!skill || isReadOnly || !isDirty || status.kind !== "ready") return;
    setSaving(true);
    try {
      await Promise.resolve(
        props.saveSkill({
          name: skill.name,
          content: draft,
          description: skill.description,
        }),
      );
      setSavedDraft(draft);
      // Re-parse to refresh frontmatter/tools preview.
      const { frontmatter, body } = parseSkillFrontmatter(draft);
      setStatus({
        kind: "ready",
        content: draft,
        frontmatter,
        body,
        tools: extractToolReferences(body),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("common.something_went_wrong");
      setStatus({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={Boolean(skill)}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="flex max-h-[92vh] min-h-0 w-full max-w-5xl flex-col overflow-hidden sm:max-w-5xl">
        {skill ? (
          <>
            <DialogHeader>
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
                  <Sparkles className="size-5 text-dls-secondary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="min-w-0 truncate">{skill.name}</DialogTitle>
                    <span className="shrink-0 rounded-full border border-dls-border bg-dls-hover px-2 py-0.5 text-[11px] font-medium text-dls-secondary">
                      {t(`skills.scope_${describeSkillScope(skill.scope)}`)}
                    </span>
                    {skill.trigger ? (
                      <span className="shrink-0 rounded-full border border-dls-border bg-dls-hover px-2 py-0.5 text-[11px] font-medium text-dls-secondary">
                        {t("skills.trigger_label_inline", undefined, { trigger: skill.trigger })}
                      </span>
                    ) : null}
                  </div>
                  <DialogDescription className="mt-1 line-clamp-2">
                    {skill.description || t("skills.no_description")}
                  </DialogDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isReadOnly ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-dls-border bg-dls-hover px-2.5 py-1 text-[11px] font-medium text-dls-secondary"
                      title={t("skills.detail_readonly_hint")}
                    >
                      <Lock className="size-3" />
                      {t("skills.detail_readonly_label")}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => void handleSave()}
                      disabled={!isDirty || saving || props.busy}
                    >
                      {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                      {t("common.save")}
                    </Button>
                  )}
                  <DialogClose
                    render={
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common.close")}>
                        <X className="size-4" />
                      </Button>
                    }
                  />
                </div>
              </div>
            </DialogHeader>

            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as string)}
              orientation="horizontal"
              className="flex min-h-0 flex-1 flex-col gap-4"
            >
              <TabsList variant="line" className="w-full justify-start border-b border-dls-border px-0">
                <TabsTrigger value="content" className={tabTriggerClass}>
                  <FileText className="size-4" />
                  {t("skills.detail_tab_content")}
                </TabsTrigger>
                <TabsTrigger value="permissions" className={tabTriggerClass}>
                  <ShieldCheck className="size-4" />
                  {t("skills.detail_tab_permissions")}
                </TabsTrigger>
                <TabsTrigger value="tools" className={tabTriggerClass}>
                  <Cable className="size-4" />
                  {t("skills.detail_tab_tools")}
                </TabsTrigger>
                <TabsTrigger value="metadata" className={tabTriggerClass}>
                  <Blocks className="size-4" />
                  {t("skills.detail_tab_metadata")}
                </TabsTrigger>
              </TabsList>

              {status.kind === "loading" ? (
                <div className="flex min-h-0 flex-1 items-center justify-center text-dls-secondary">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="ml-2 text-sm">{t("skills.loading")}</span>
                </div>
              ) : status.kind === "error" ? (
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia>
                        <X className="text-destructive" />
                      </EmptyMedia>
                      <EmptyTitle>{t("skills.detail_load_failed_title")}</EmptyTitle>
                      <EmptyDescription>{status.message}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </div>
              ) : (
                <DetailContent
                  skill={skill}
                  isReadOnly={isReadOnly}
                  draft={draft}
                  savedDraft={savedDraft}
                  isDirty={isDirty}
                  onDraftChange={setDraft}
                  frontmatter={status.frontmatter}
                  body={status.body}
                  tools={status.tools}
                  activeTab={activeTab}
                />
              )}
            </Tabs>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type DetailContentProps = {
  skill: SkillCard;
  isReadOnly: boolean;
  draft: string;
  savedDraft: string;
  isDirty: boolean;
  onDraftChange: (value: string) => void;
  frontmatter: SkillFrontmatter;
  body: string;
  tools: SkillToolReference[];
  activeTab: string;
};

function DetailContent(props: DetailContentProps) {
  const {
    skill,
    isReadOnly,
    draft,
    savedDraft,
    isDirty,
    onDraftChange,
    frontmatter,
    body,
    tools,
    activeTab,
  } = props;

  // Re-parse the live draft so the preview stays in sync while the user
  // edits — saves the user from having to click Save to see the impact
  // of their changes.
  const liveFrontmatter = useMemo(() => {
    if (!isDirty) return frontmatter;
    return parseSkillFrontmatter(draft).frontmatter;
  }, [draft, frontmatter, isDirty]);

  const liveBody = useMemo(() => {
    if (!isDirty) return body;
    return parseSkillFrontmatter(draft).body;
  }, [draft, body, isDirty]);

  return (
    <>
      <TabsContent value="content" className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col rounded-2xl border border-dls-border bg-dls-surface">
          <div className="flex items-center justify-between border-b border-dls-border px-4 py-2.5">
            <span className="text-xs font-medium text-dls-secondary">
              {isReadOnly ? t("skills.detail_source_label") : t("skills.detail_editor_label")}
            </span>
            {isDirty && !isReadOnly ? (
              <span className="text-[11px] font-medium text-amber-11">{t("skills.detail_unsaved_changes")}</span>
            ) : null}
          </div>
          <Textarea
            value={draft}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            readOnly={isReadOnly}
            spellCheck={false}
            className={cn(
              "min-h-[420px] flex-1 resize-none rounded-none border-0 bg-dls-surface px-4 py-3 font-mono text-xs text-dls-text focus:outline-none focus:ring-0",
              isReadOnly && "cursor-default",
            )}
          />
        </div>
        <div className="flex min-h-0 flex-col rounded-2xl border border-dls-border bg-dls-surface">
          <div className="flex items-center justify-between border-b border-dls-border px-4 py-2.5">
            <span className="text-xs font-medium text-dls-secondary">{t("skills.detail_preview_label")}</span>
            <span className="text-[11px] text-dls-secondary">{t("skills.detail_body_chars", undefined, { count: liveBody.length })}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {liveBody.trim().length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia>
                    <Eye className="text-dls-secondary" />
                  </EmptyMedia>
                  <EmptyTitle>{t("skills.detail_empty_body_title")}</EmptyTitle>
                  <EmptyDescription>{t("skills.detail_empty_body_desc")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <MarkdownBlock text={liveBody} />
            )}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="permissions" className="min-h-0 flex-1 overflow-y-auto pr-1">
        <PermissionsPanel frontmatter={liveFrontmatter} skill={skill} />
      </TabsContent>

      <TabsContent value="tools" className="min-h-0 flex-1 overflow-y-auto pr-1">
        <ToolsPanel tools={tools} body={liveBody} />
      </TabsContent>

      <TabsContent value="metadata" className="min-h-0 flex-1 overflow-y-auto pr-1">
        <MetadataPanel skill={skill} frontmatter={liveFrontmatter} isDirty={isDirty} savedDraft={savedDraft} activeTab={activeTab} />
      </TabsContent>
    </>
  );
}

function PermissionsPanel(props: { frontmatter: SkillFrontmatter; skill: SkillCard }) {
  const { frontmatter, skill } = props;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <header className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-dls-secondary" />
          <h3 className="text-sm font-medium text-dls-text">{t("skills.detail_permissions_allowed_tools")}</h3>
        </header>
        {frontmatter.allowedTools.length === 0 ? (
          <p className="text-xs text-dls-secondary">{t("skills.detail_permissions_no_tools")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {frontmatter.allowedTools.map((tool) => (
              <li
                key={tool}
                className="inline-flex items-center gap-1 rounded-full border border-dls-border bg-dls-hover px-2.5 py-1 text-[12px] font-mono text-dls-text"
              >
                <KeyRound className="size-3 text-dls-secondary" />
                {tool}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-dls-secondary">
          {t("skills.detail_permissions_edit_hint")}
        </p>
      </section>

      <section className="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <header className="mb-3 flex items-center gap-2">
          <Blocks className="size-4 text-dls-secondary" />
          <h3 className="text-sm font-medium text-dls-text">{t("skills.detail_permissions_model")}</h3>
        </header>
        {frontmatter.model ? (
          <code className="rounded-md bg-dls-hover px-2 py-1 font-mono text-xs text-dls-text">{frontmatter.model}</code>
        ) : (
          <p className="text-xs text-dls-secondary">{t("skills.detail_permissions_no_model")}</p>
        )}
      </section>

      <section className="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <header className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-dls-secondary" />
          <h3 className="text-sm font-medium text-dls-text">{t("skills.detail_permissions_trigger")}</h3>
        </header>
        {frontmatter.trigger || skill.trigger ? (
          <p className="text-sm text-dls-text">{frontmatter.trigger || skill.trigger}</p>
        ) : (
          <p className="text-xs text-dls-secondary">{t("skills.detail_permissions_no_trigger")}</p>
        )}
      </section>
    </div>
  );
}

function ToolsPanel(props: { tools: SkillToolReference[]; body: string }) {
  if (props.tools.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <Cable className="text-dls-secondary" />
          </EmptyMedia>
          <EmptyTitle>{t("skills.detail_tools_empty_title")}</EmptyTitle>
          <EmptyDescription>{t("skills.detail_tools_empty_desc")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <header className="mb-3 flex items-center gap-2">
          <Cable className="size-4 text-dls-secondary" />
          <h3 className="text-sm font-medium text-dls-text">
            {t("skills.detail_tools_referenced_title")}
          </h3>
          <span className="rounded-full border border-dls-border bg-dls-hover px-2 py-0.5 text-[11px] font-medium text-dls-secondary">
            {t("skills.detail_tools_count", undefined, { count: props.tools.length })}
          </span>
        </header>
        <p className="mb-3 text-[11px] text-dls-secondary">{t("skills.detail_tools_referenced_hint")}</p>
        <ul className="flex flex-col gap-2">
          {props.tools.map((tool) => (
            <li
              key={tool.name}
              className="flex items-center justify-between rounded-xl border border-dls-border bg-dls-hover px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm text-dls-text">
                <KeyRound className="size-3.5 text-dls-secondary" />
                <span className="font-mono">{tool.name}</span>
              </span>
              <span className="rounded-full border border-dls-border bg-dls-surface px-2 py-0.5 text-[11px] font-medium text-dls-secondary">
                {t("skills.detail_tools_uses", undefined, { count: tool.count })}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function MetadataPanel(props: {
  skill: SkillCard;
  frontmatter: SkillFrontmatter;
  isDirty: boolean;
  savedDraft: string;
  activeTab: string;
}) {
  const { skill, frontmatter } = props;
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t("skills.detail_meta_name"), value: <span className="font-mono">{skill.name}</span> },
    { label: t("skills.detail_meta_scope"), value: t(`skills.scope_${describeSkillScope(skill.scope)}`) },
    { label: t("skills.detail_meta_path"), value: <PathCell path={skill.path} /> },
    {
      label: t("skills.detail_meta_description"),
      value: skill.description ? skill.description : <EmptyValue />,
    },
    {
      label: t("skills.detail_meta_category"),
      value: skill.category ? <span className="font-mono">{skill.category}</span> : <EmptyValue />,
    },
    {
      label: t("skills.detail_meta_trigger"),
      value: frontmatter.trigger || skill.trigger ? (
        <span>{frontmatter.trigger || skill.trigger}</span>
      ) : (
        <EmptyValue />
      ),
    },
    {
      label: t("skills.detail_meta_model"),
      value: frontmatter.model ? <span className="font-mono">{frontmatter.model}</span> : <EmptyValue />,
    },
    {
      label: t("skills.detail_meta_frontmatter_keys"),
      value:
        Object.keys(frontmatter.raw).length === 0 ? (
          <EmptyValue />
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {Object.keys(frontmatter.raw).map((key) => (
              <li
                key={key}
                className="rounded-full border border-dls-border bg-dls-hover px-2 py-0.5 text-[11px] font-mono text-dls-secondary"
              >
                {key}
              </li>
            ))}
          </ul>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-dls-border bg-dls-surface p-4">
        <header className="mb-3 flex items-center gap-2">
          <Blocks className="size-4 text-dls-secondary" />
          <h3 className="text-sm font-medium text-dls-text">{t("skills.detail_metadata_title")}</h3>
        </header>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-[180px_1fr]">
          {rows.map((row) => (
            <div key={row.label} className="flex min-w-0 flex-col gap-1 md:contents">
              <dt className="text-[12px] font-medium text-dls-secondary">{row.label}</dt>
              <dd className="min-w-0 text-sm text-dls-text">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function PathCell({ path }: { path: string }) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2 rounded-md bg-dls-hover px-2 py-1 font-mono text-xs text-dls-text"
      title={path}
    >
      <Folder className="size-3.5 shrink-0 text-dls-secondary" />
      <span className="truncate">{path}</span>
    </span>
  );
}

function EmptyValue() {
  return <span className="text-xs italic text-dls-secondary">{t("common.empty_value")}</span>;
}