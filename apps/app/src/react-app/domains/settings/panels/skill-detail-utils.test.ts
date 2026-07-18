/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";

import {
  buildNewSkillTemplate,
  describeSkillScope,
  extractToolReferences,
  parseSkillFrontmatter,
} from "./skill-detail-utils";

describe("parseSkillFrontmatter", () => {
  test("returns empty frontmatter when content has no frontmatter block", () => {
    const result = parseSkillFrontmatter("# Heading\n\nPlain text body.");
    expect(result.frontmatter.name).toBe("");
    expect(result.frontmatter.description).toBe("");
    expect(result.frontmatter.allowedTools).toEqual([]);
    expect(result.body).toBe("# Heading\n\nPlain text body.");
  });

  test("parses scalar keys and inline lists", () => {
    const content = [
      "---",
      "name: greet-user",
      "description: Greet the user by name",
      "allowed-tools: [bash, read, edit]",
      "model: anthropic/claude-sonnet",
      "trigger: /greet",
      "---",
      "",
      "# greet-user",
      "Body.",
    ].join("\n");
    const result = parseSkillFrontmatter(content);
    expect(result.frontmatter.name).toBe("greet-user");
    expect(result.frontmatter.description).toBe("Greet the user by name");
    expect(result.frontmatter.allowedTools).toEqual(["bash", "read", "edit"]);
    expect(result.frontmatter.model).toBe("anthropic/claude-sonnet");
    expect(result.frontmatter.trigger).toBe("/greet");
    expect(result.body.trim()).toBe("# greet-user\nBody.");
  });

  test("supports allowed_tools underscore variant", () => {
    const content = [
      "---",
      "name: legacy",
      "allowed_tools: [bash]",
      "---",
      "body",
    ].join("\n");
    const result = parseSkillFrontmatter(content);
    expect(result.frontmatter.allowedTools).toEqual(["bash"]);
  });

  test("unterminated frontmatter falls back to body", () => {
    const content = "---\nname: broken\ndesc: never closes";
    const result = parseSkillFrontmatter(content);
    expect(result.frontmatter.name).toBe("");
    expect(result.body).toBe(content);
  });

  test("strips surrounding quotes from string values", () => {
    const content = [
      "---",
      'name: "quoted-name"',
      "description: 'single quoted'",
      "---",
      "body",
    ].join("\n");
    const result = parseSkillFrontmatter(content);
    expect(result.frontmatter.name).toBe("quoted-name");
    expect(result.frontmatter.description).toBe("single quoted");
  });
});

describe("extractToolReferences", () => {
  test("counts $tool-name placeholders case-insensitively", () => {
    const body = "Use $bash then $read. For Linear, call $mcp-linear. The bash again: $BASH.";
    const refs = extractToolReferences(body);
    expect(refs[0]).toEqual({ name: "bash", count: 2 });
    expect(refs.find((ref) => ref.name === "read")).toEqual({ name: "read", count: 1 });
    expect(refs.find((ref) => ref.name === "mcp-linear")).toEqual({ name: "mcp-linear", count: 1 });
  });

  test("returns empty list when body has no references", () => {
    expect(extractToolReferences("plain body without references")).toEqual([]);
    expect(extractToolReferences("")).toEqual([]);
  });

  test("ignores references preceded by other characters that are not $", () => {
    expect(extractToolReferences("price $5.00 — not a reference")).toEqual([]);
  });
});

describe("buildNewSkillTemplate", () => {
  test("includes valid frontmatter and a heading", () => {
    const tmpl = buildNewSkillTemplate("demo-skill", "Does demo things.");
    expect(tmpl).toContain("name: demo-skill");
    expect(tmpl).toContain("description: Does demo things.");
    expect(tmpl).toContain("# demo-skill");
    expect(tmpl).toContain("## What this skill does");
  });

  test("uses a TODO description when none provided", () => {
    const tmpl = buildNewSkillTemplate("demo", "");
    expect(tmpl).toContain("description: TODO: describe what demo does.");
  });
});

describe("describeSkillScope", () => {
  test("returns workspace for project", () => {
    expect(describeSkillScope("project")).toBe("workspace");
  });
  test("returns global for global", () => {
    expect(describeSkillScope("global")).toBe("global");
  });
  test("falls back to workspace for undefined", () => {
    expect(describeSkillScope(undefined)).toBe("workspace");
  });
});