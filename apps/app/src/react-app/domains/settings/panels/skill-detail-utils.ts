/** @jsxImportSource react */
export type SkillFrontmatter = {
  raw: Record<string, unknown>;
  name: string;
  description: string;
  /** Allow-list of tools the skill is permitted to invoke. */
  allowedTools: string[];
  /** Optional preferred model. */
  model: string | null;
  /** Optional trigger phrase surfaced by the engine. */
  trigger: string | null;
};

export type SkillToolReference = {
  /** Bare tool identifier (e.g. `bash`, `read`, `mcp-linear`, `skill-creator`). */
  name: string;
  /** How many times this tool was referenced in the body. */
  count: number;
};

export const EMPTY_SKILL_FRONTMATTER: SkillFrontmatter = {
  raw: {},
  name: "",
  description: "",
  allowedTools: [],
  model: null,
  trigger: null,
};

/**
 * Parse the YAML-ish frontmatter block at the top of a SKILL.md file.
 * The format is a small subset of YAML:
 *
 *   ---
 *   name: my-skill
 *   description: ...
 *   allowed-tools: [bash, edit]
 *   model: anthropic/claude-sonnet
 *   ---
 *
 * We deliberately avoid pulling in a YAML parser — skills rarely use the
 * long tail of YAML features. The parser handles the cases we observe in
 * the OpenWork default skills plus community skills shipped via the hub.
 */
export function parseSkillFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  if (!content.startsWith("---")) {
    return { frontmatter: { ...EMPTY_SKILL_FRONTMATTER, raw: {} }, body: content };
  }

  const lines = content.split(/\r?\n/);
  // Find the closing `---` (skip the opening one at index 0).
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      closeIndex = i;
      break;
    }
  }

  if (closeIndex === -1) {
    // Unterminated frontmatter; treat the whole document as body.
    return { frontmatter: { ...EMPTY_SKILL_FRONTMATTER, raw: {} }, body: content };
  }

  const frontmatterLines = lines.slice(1, closeIndex);
  const body = lines.slice(closeIndex + 1).join("\n");
  const raw: Record<string, unknown> = {};

  for (const rawLine of frontmatterLines) {
    const line = rawLine.trimEnd();
    if (!line || line.trim().startsWith("#")) continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();
    value = stripQuotes(value);

    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = parseInlineList(value);
    } else if (typeof value === "string" && value.includes("\n")) {
      // Multiline scalar -> join with literal newlines.
      value = value.split(/\r?\n/).map((part) => part.trim()).filter(Boolean).join(" ");
    }

    raw[key] = value;
  }

  const allowedTools = Array.isArray(raw["allowed-tools"])
    ? (raw["allowed-tools"] as unknown[]).filter((item): item is string => typeof item === "string")
    : Array.isArray(raw["allowed_tools"])
      ? (raw["allowed_tools"] as unknown[]).filter((item): item is string => typeof item === "string")
      : typeof raw["allowed-tools"] === "string"
        ? raw["allowed-tools"].split(",").map((item) => item.trim()).filter(Boolean)
        : typeof raw["allowed_tools"] === "string"
          ? raw["allowed_tools"].split(",").map((item) => item.trim()).filter(Boolean)
          : [];

  return {
    frontmatter: {
      raw,
      name: typeof raw.name === "string" ? raw.name : "",
      description: typeof raw.description === "string" ? raw.description : "",
      allowedTools,
      model: typeof raw.model === "string" ? raw.model : null,
      trigger: typeof raw.trigger === "string" ? raw.trigger : null,
    },
    body,
  };
}

function stripQuotes(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseInlineList(value: string): string[] {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((item) => stripQuotes(item.trim()))
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}

/**
 * Extract external tool references referenced inside the skill body. The
 * engine exposes a `$tool-name` convention (e.g. `$bash`, `$mcp-linear`,
 * `$skill-creator`). Counting occurrences helps the operator spot
 * permissions they might need to grant before installing the skill.
 *
 * Note: a cheap regex cannot distinguish `$bash` from `$5.00` (a price).
 * We therefore drop identifiers that are pure digits — real tool names
 * always start with a letter and contain at least one alpha character.
 */
export function extractToolReferences(body: string): SkillToolReference[] {
  if (!body) return [];
  const matches = body.match(/\$([a-z0-9_-]+)/gi);
  if (!matches) return [];

  const counts = new Map<string, number>();
  for (const match of matches) {
    const name = match.slice(1).trim().toLowerCase();
    if (!name) continue;
    if (!/[a-z]/i.test(name)) continue; // skip "$5.00"-style false positives
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
}

/**
 * Build a starter SKILL.md body for the "New skill" modal. The user can edit
 * any of it after creation; this exists so the resulting file already has
 * valid frontmatter and a heading.
 */
export function buildNewSkillTemplate(name: string, description: string): string {
  const safeDescription = description.trim() || `TODO: describe what ${name} does.`;
  return [
    "---",
    `name: ${name}`,
    `description: ${safeDescription}`,
    "---",
    "",
    `# ${name}`,
    "",
    "## What this skill does",
    "",
    safeDescription,
    "",
    "## When to use it",
    "",
    "Describe the trigger phrases or scenarios that should activate this skill.",
    "",
    "## Steps",
    "",
    "1. First step.",
    "2. Second step.",
    "3. Confirm the result.",
    "",
  ].join("\n");
}

/**
 * Friendly label for a scope value, suitable for badges.
 */
export function describeSkillScope(scope: "project" | "global" | undefined): string {
  return scope === "global" ? "global" : "workspace";
}