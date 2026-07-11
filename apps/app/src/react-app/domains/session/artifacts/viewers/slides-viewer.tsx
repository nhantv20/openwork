/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PreviewLoading, PreviewError, PreviewUnavailable } from "../preview";

interface SlidesViewerProps {
  url: string;
  filePath?: string;
  title: string;
  className?: string;
}

interface OfficeCliResult {
  success?: boolean;
  data?: string;
  message?: string;
  html?: string;
  raw?: string;
}

interface ElectronBridge {
  invokeDesktop?: (cmd: string, ...args: unknown[]) => Promise<unknown>;
}

function getElectronBridge(): ElectronBridge | undefined {
  return (window as unknown as Record<string, unknown>).__OPENWORK_ELECTRON__ as ElectronBridge | undefined;
}

function extractHtml(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as OfficeCliResult;
  return r.html ?? r.raw ?? r.data ?? null;
}

async function readOfficeCliFromPath(filePath: string): Promise<string | null> {
  const electron = getElectronBridge();
  if (!electron?.invokeDesktop) return null;
  const result = await electron.invokeDesktop("officecli", "view", filePath, "html");
  return extractHtml(result);
}

async function readOfficeCliFromUrl(url: string, ext: string): Promise<string | null> {
  const electron = getElectronBridge();
  if (!electron?.invokeDesktop) return null;
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk) as number[]);
  }
  const base64 = btoa(binary);
  const result = await electron.invokeDesktop("officecli", "convert", base64, ext, "html");
  return extractHtml(result);
}

export function SlidesViewer({ url, filePath, title, className }: SlidesViewerProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function run() {
      try {
        const ext = title.split(".").pop() ?? "pptx";
        const result = filePath
          ? await readOfficeCliFromPath(filePath)
          : await readOfficeCliFromUrl(url, ext);
        if (cancelled) return;
        if (result) {
          setHtml(result);
          setLoading(false);
        } else {
          setError(filePath ? "OfficeCLI not available in this environment" : "OfficeCLI not available in this environment");
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Conversion failed");
        setLoading(false);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [url, filePath, title]);

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