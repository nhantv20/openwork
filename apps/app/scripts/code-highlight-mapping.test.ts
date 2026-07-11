import { describe, expect, it } from "bun:test";

import { mapExtensionToShikiLang } from "../src/react-app/domains/session/artifacts/preview";

describe("mapExtensionToShikiLang", () => {
  it.each([
    ["ts", "typescript"],
    ["tsx", "tsx"],
    ["js", "javascript"],
    ["mjs", "javascript"],
    ["cjs", "javascript"],
    ["py", "python"],
    ["rb", "ruby"],
    ["go", "go"],
    ["rs", "rust"],
    ["java", "java"],
    ["kt", "kotlin"],
    ["swift", "swift"],
    ["cpp", "cpp"],
    ["cc", "cpp"],
    ["h", "c"],
    ["hpp", "cpp"],
    ["vue", "vue"],
    ["svelte", "svelte"],
    ["astro", "astro"],
    ["graphql", "graphql"],
    ["gql", "graphql"],
    ["prisma", "prisma"],
    ["toml", "toml"],
    ["ini", "ini"],
    ["r", "r"],
    ["jl", "julia"],
    ["dart", "dart"],
    ["ex", "elixir"],
    ["exs", "elixir"],
    ["fs", "fsharp"],
    ["fsx", "fsharp"],
    ["diff", "diff"],
    ["patch", "diff"],
    ["sh", "bash"],
    ["bash", "bash"],
    ["zsh", "bash"],
  ])("maps %s to %s", (ext, expected) => {
    expect(mapExtensionToShikiLang(ext)).toBe(expected);
  });

  it("normalizes to lowercase", () => {
    expect(mapExtensionToShikiLang("TSX")).toBe("tsx");
    expect(mapExtensionToShikiLang("PY")).toBe("python");
  });

  it("returns the ext as-is when unknown (Shiki will surface the error)", () => {
    expect(mapExtensionToShikiLang("nope")).toBe("nope");
  });

  it("treats txt/log/conf/env as plain text lang", () => {
    expect(mapExtensionToShikiLang("txt")).toBe("text");
    expect(mapExtensionToShikiLang("log")).toBe("text");
    expect(mapExtensionToShikiLang("conf")).toBe("text");
    expect(mapExtensionToShikiLang("env")).toBe("text");
  });
});
