/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PreviewLoading, PreviewError, PreviewUnavailable } from "../preview";

interface DocumentViewerProps {
  url: string;
  title: string;
  className?: string;
}

const DOCX_STYLES = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    padding: 2rem;
    max-width: 800px;
    margin: 0 auto;
    line-height: 1.6;
    color: #1a1a1a;
  }
  h1, h2, h3, h4, h5, h6 {
    color: #1a1a1a;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    font-weight: 600;
  }
  h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  p { margin: 0.8em 0; }
  ul, ol { padding-left: 2em; }
  li { margin: 0.25em 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  td, th { border: 1px solid #ccc; padding: 8px; }
  th { background: #f6f8fa; font-weight: 600; }
  blockquote {
    margin: 0.8em 0;
    padding: 0.5em 1em;
    border-left: 4px solid #dfe2e5;
    color: #6a737d;
  }
  code {
    background: #f6f8fa;
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-size: 0.9em;
  }
  pre {
    background: #f6f8fa;
    padding: 1em;
    border-radius: 6px;
    overflow: auto;
  }
  img { max-width: 100%; height: auto; }
  a { color: #0366d6; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

export function DocumentViewer({ url, title, className }: DocumentViewerProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((res) => res.arrayBuffer())
      .then(async (buf) => {
        const { convertToHtml } = await import("mammoth");
        const result = await convertToHtml({ arrayBuffer: buf });
        if (!cancelled) {
          const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${DOCX_STYLES}</style></head><body>${result.value}</body></html>`;
          setHtml(wrappedHtml);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [url]);

  if (loading) return <PreviewLoading className={className} />;
  if (error) return <PreviewError message={error} className={className} />;
  if (!html) return <PreviewUnavailable className={className} />;

  return (
    <iframe
      srcDoc={html}
      title={title}
      className={cn("h-full w-full border-0", className)}
      sandbox="allow-scripts"
    />
  );
}