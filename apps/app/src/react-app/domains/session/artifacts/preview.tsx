/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { Loader2 } from "lucide-react";
import { codeToHtml } from "shiki";

import { cn } from "@/lib/utils";
import { MarkdownBlock } from "../surface/markdown";

interface PreviewLoadingProps extends React.ComponentProps<"div"> {}

export function PreviewLoading({ className, ...props }: PreviewLoadingProps) {
  return (
    <div className={cn("flex h-full items-center justify-center text-muted-foreground", className)} {...props}>
      <Loader2 className="size-4 animate-spin" />
    </div>
  );
}

interface PreviewErrorProps extends React.ComponentProps<"div"> {
  message: string;
}

export function PreviewError({ message, className, ...props }: PreviewErrorProps) {
  return <div className={cn("p-4 text-sm text-muted-foreground", className)} {...props}>{message}</div>;
}

interface PlainTextProps extends React.ComponentProps<"pre"> {
  content: string;
}

export function PlainText({ content, className, ...props }: PlainTextProps) {
  return <pre className={cn("h-full overflow-auto p-4 text-xs leading-5 text-foreground whitespace-pre-wrap", className)} {...props}>{content}</pre>;
}

interface MarkdownPreviewProps extends React.ComponentProps<"div"> {
  content: string;
}

export function MarkdownPreview({ content, className, ...props }: MarkdownPreviewProps) {
  return (
    <div className={cn("h-full overflow-auto p-4", className)} {...props}>
      <MarkdownBlock text={content} />
    </div>
  );
}

interface TextHTMLPreviewProps {
  type: "text";
  title: string;
  content: string;
}

interface BinaryHTMLPreviewProps {
  type: "binary";
  title: string;
  url: string;
}

type HTMLPreviewProps = { className?: string } & (TextHTMLPreviewProps | BinaryHTMLPreviewProps);

export function HTMLPreview({ className, ...props }: HTMLPreviewProps) {
  if (props.type === "text") {
    return <iframe srcDoc={props.content} title={props.title} className={cn("h-full w-full border-0", className)} sandbox="allow-scripts" />;
  }

  return <iframe src={props.url} title={props.title} className={cn("h-full w-full border-0", className)} sandbox="allow-scripts" />;
}

interface PdfPreviewProps {
  url: string;
  title: string;
  className?: string;
}

export function PdfPreview({ url, title, className }: PdfPreviewProps) {
  return <embed src={url} type="application/pdf" title={title} className={cn("h-full w-full border-0", className)} />;
}

interface ImagePreviewProps extends React.ComponentProps<"div"> {
  src: string;
  alt: string;
}

export function ImagePreview({ src, alt, className, ...props }: ImagePreviewProps) {
  return (
    <div className={cn("flex h-full items-center justify-center overflow-auto bg-muted/30 p-3", className)} {...props}>
      <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

// ── CodePreview (Shiki syntax highlight) ─────────────────────────────────

interface CodePreviewProps {
  code: string;
  language?: string;
  className?: string;
}

const SHIKI_LANG_MAP: Record<string, string> = {
  tsx: "tsx",
  ts: "typescript",
  jsx: "jsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  php: "php",
  c: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  md: "markdown",
  mdx: "mdx",
  markdown: "markdown",
  graphql: "graphql",
  gql: "graphql",
  prisma: "prisma",
  dockerfile: "dockerfile",
  ini: "ini",
  lua: "lua",
  r: "r",
  jl: "julia",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  elm: "elm",
  clj: "clojure",
  cljs: "clojure",
  cljr: "clojure",
  scala: "scala",
  hs: "haskell",
  purs: "purescript",
  ml: "ocaml",
  fs: "fsharp",
  fsi: "fsharp",
  fsx: "fsharp",
  vb: "vb",
  asm: "asm",
  s: "asm",
  pl: "perl",
  pm: "perl",
  tcl: "tcl",
  rkt: "racket",
  scm: "scheme",
  ss: "scheme",
  diff: "diff",
  patch: "diff",
  txt: "text",
  log: "text",
  conf: "text",
  env: "text",
};

export function mapExtensionToShikiLang(ext: string): string {
  return SHIKI_LANG_MAP[ext.toLowerCase()] ?? ext.toLowerCase();
}

export function CodePreview({ code, language = "tsx", className }: CodePreviewProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const shikiLang = mapExtensionToShikiLang(language);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    codeToHtml(code, { lang: shikiLang, theme: "github-light" })
      .then((result) => {
        if (!cancelled) {
          setHtml(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml(null);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [code, shikiLang]);

  if (loading && !html) {
    return <PreviewLoading className={className} />;
  }

  if (!html) {
    return <PlainText content={code} className={className} />;
  }

  return (
    <div
      className={cn("h-full overflow-auto [&>pre]:p-4 [&>pre]:text-xs [&>pre]:leading-5", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── DiffPreview (patch visualization) ────────────────────────────────────

interface DiffPreviewProps {
  diff: string;
  className?: string;
}

function diffLineClass(line: string): string {
  if (line.startsWith("+")) return "bg-green-2 text-green-11";
  if (line.startsWith("-")) return "bg-red-2 text-red-11";
  if (line.startsWith("@@")) return "bg-blue-2 text-blue-11";
  if (line.startsWith("diff --git") || line.startsWith("---") || line.startsWith("+++")) return "text-muted-foreground text-xs";
  return "";
}

export function DiffPreview({ diff, className }: DiffPreviewProps) {
  return (
    <pre className={cn("h-full overflow-auto p-4 text-xs leading-5 whitespace-pre-wrap font-mono", className)}>
      {diff.split("\n").map((line, i) => (
        <div key={i} className={diffLineClass(line)}>
          {line}
        </div>
      ))}
    </pre>
  );
}

// ── VideoPreview (MP4/WebM) ──────────────────────────────────────────────

interface VideoPreviewProps {
  url: string;
  title: string;
  className?: string;
}

export function VideoPreview({ url, title, className }: VideoPreviewProps) {
  return (
    <div className={cn("flex h-full items-center justify-center bg-black/5 p-4", className)}>
      <video controls className="max-h-full max-w-full" title={title}>
        <source src={url} />
      </video>
    </div>
  );
}

// ── AudioPreview (MP3/WAV) ───────────────────────────────────────────────

interface AudioPreviewProps {
  url: string;
  title: string;
  className?: string;
}

export function AudioPreview({ url, title, className }: AudioPreviewProps) {
  return (
    <div className={cn("flex h-full items-center justify-center p-8", className)}>
      <audio controls className="w-full max-w-lg" title={title}>
        <source src={url} />
      </audio>
    </div>
  );
}

// ── PreviewUnavailable ───────────────────────────────────────────────────

interface PreviewUnavailableProps extends React.ComponentProps<"div"> {}

export function PreviewUnavailable({ className, ...props }: PreviewUnavailableProps) {
  return <div className={cn("p-4 text-sm text-muted-foreground", className)} {...props}>Preview unavailable. Open externally to view this file.</div>;
}
