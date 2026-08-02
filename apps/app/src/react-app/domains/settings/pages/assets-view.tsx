/** @jsxImportSource react */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, FileText, Layers, Loader2, Package, Plus, Search, Trash2 } from "lucide-react";

import type { OpenworkAssetManifest, OpenworkAssetSummary, OpenworkServerClient } from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  LayoutSection,
  LayoutSectionContent,
  LayoutSectionHeader,
  LayoutSectionTitle,
  LayoutStack,
} from "../settings-layout";
import { SettingsInset } from "../settings-section";
import { toast } from "@/components/ui/sonner";

type AssetsViewProps = {
  openworkClient: OpenworkServerClient | null;
  selectedWorkspaceId: string;
  selectedWorkspaceRoot?: string;
  isRemoteWorkspace: boolean;
  navigate: (path: string) => void;
};

function kindIcon(kind: OpenworkAssetSummary["kind"]) {
  if (kind === "bundle") return Layers;
  if (kind === "file") return FileText;
  return Archive;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AssetsView({
  openworkClient,
  selectedWorkspaceId,
  isRemoteWorkspace,
}: AssetsViewProps) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<OpenworkAssetSummary["scope"] | "">("");
  const [kind, setKind] = useState<OpenworkAssetSummary["kind"] | "">("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["assets", selectedWorkspaceId, scope, kind, q],
    enabled: Boolean(openworkClient && selectedWorkspaceId),
    queryFn: async () => {
      if (!openworkClient) throw new Error("No client");
      const res = await openworkClient.listAssets(selectedWorkspaceId, { scope: scope || undefined, kind: kind || undefined, q });
      return res.items;
    },
  });

  const manifestQuery = useQuery({
    queryKey: ["asset-manifest", selectedWorkspaceId, selectedId],
    enabled: Boolean(openworkClient && selectedWorkspaceId && selectedId),
    queryFn: async () => {
      if (!openworkClient || !selectedId) throw new Error("Missing client or id");
      const [scope, ...rest] = selectedId.split("/");
      const ns = rest.slice(0, -1).join("/");
      const name = rest[rest.length - 1];
      const res = await openworkClient.getAsset(selectedWorkspaceId, scope as OpenworkAssetSummary["scope"], ns, name);
      return res.manifest;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!openworkClient) throw new Error("No client");
      const [scope, ...rest] = id.split("/");
      const ns = rest.slice(0, -1).join("/");
      const name = rest[rest.length - 1];
      return openworkClient.deleteAsset(selectedWorkspaceId, scope as OpenworkAssetSummary["scope"], ns, name);
    },
    onSuccess: (res, id) => {
      toast.success(`Removed ${res.removedVersions.length} version(s) for ${id}`);
      void queryClient.invalidateQueries({ queryKey: ["assets", selectedWorkspaceId] });
      if (selectedId === id) setSelectedId(null);
    },
    onError: (err) => {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const items = listQuery.data ?? [];

  return (
    <LayoutStack>
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>Asset Library</LayoutSectionTitle>
        </LayoutSectionHeader>
        <LayoutSectionContent>
          <SettingsInset>
            <p className="text-sm text-muted-foreground">
              Versioned files, bundles, and text snippets addressable via{" "}
              <code className="font-mono text-xs">asset://&lt;scope&gt;/&lt;id&gt;[@version][#file]</code>. Agent, skill,
              and plugin can resolve references without hard-coded paths.
            </p>
          </SettingsInset>
        </LayoutSectionContent>
      </LayoutSection>

      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>Browse</LayoutSectionTitle>
        </LayoutSectionHeader>
        <LayoutSectionContent>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, id, or tag"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8"
              />
            </div>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as OpenworkAssetSummary["scope"] | "")}
              className="rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="">All scopes</option>
              <option value="workspace">workspace</option>
              <option value="local">local</option>
              <option value="org">org</option>
              <option value="hub">hub</option>
            </select>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as OpenworkAssetSummary["kind"] | "")}
              className="rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="">All kinds</option>
              <option value="text">text</option>
              <option value="file">file</option>
              <option value="bundle">bundle</option>
            </select>
            <Button variant="default" size="sm" disabled>
              <Plus className="mr-1 size-4" /> New asset
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
            <div className="space-y-2">
              {listQuery.isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading...
                </div>
              )}
              {listQuery.isError && (
                <div className="text-sm text-destructive">
                  {(listQuery.error as Error).message}
                </div>
              )}
              {!listQuery.isLoading && items.length === 0 && (
                <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No assets in this workspace yet. Upload via API or wait for the agent to create one.
                </div>
              )}
              {items.map((asset) => {
                const Icon = kindIcon(asset.kind);
                const selected = selectedId === `${asset.scope}/${asset.id}`;
                return (
                  <button
                    key={`${asset.scope}/${asset.id}`}
                    onClick={() => setSelectedId(`${asset.scope}/${asset.id}`)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      selected ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{asset.id}</span>
                          <Badge variant="outline" className="text-xs">{asset.scope}</Badge>
                          <Badge variant="outline" className="text-xs">v{asset.version}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {asset.name} · {asset.kind} · {formatBytes(asset.size)} · updated{" "}
                          {new Date(asset.updatedAt).toLocaleString()}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {asset.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              {!selectedId && (
                <div className="text-sm text-muted-foreground">
                  <Package className="mb-2 size-5" />
                  Select an asset to see manifest, files, and versions.
                </div>
              )}
              {selectedId && manifestQuery.isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading manifest...
                </div>
              )}
              {selectedId && manifestQuery.data && (
                <div className="space-y-3 text-sm">
                  <div className="font-mono text-xs">{manifestQuery.data.id}</div>
                  <div>
                    <span className="text-muted-foreground">Version:</span> v{manifestQuery.data.version}
                  </div>
                  <div>
                    <span className="text-muted-foreground">MIME:</span> {manifestQuery.data.mime}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Size:</span> {formatBytes(manifestQuery.data.size)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Checksum:</span>{" "}
                    <code className="text-xs">{manifestQuery.data.checksum.slice(0, 24)}…</code>
                  </div>
                  {manifestQuery.data.description && (
                    <div>
                      <span className="text-muted-foreground">Description:</span>{" "}
                      {manifestQuery.data.description}
                    </div>
                  )}
                  {manifestQuery.data.files && manifestQuery.data.files.length > 0 && (
                    <div>
                      <div className="mb-1 text-muted-foreground">Files:</div>
                      <ul className="space-y-1 pl-3">
                        {manifestQuery.data.files.map((file) => (
                          <li key={file.path} className="font-mono text-xs">
                            {file.path} <span className="text-muted-foreground">({formatBytes(file.size)})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleteMutation.isPending || isRemoteWorkspace}
                      onClick={() => {
                        if (selectedId) deleteMutation.mutate(selectedId);
                      }}
                    >
                      <Trash2 className="mr-1 size-3.5" /> Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </LayoutSectionContent>
      </LayoutSection>
    </LayoutStack>
  );
}
