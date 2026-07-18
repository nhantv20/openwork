import type { WorkspaceWire } from "@openwork/types/workspace";

export type WorkspaceType = "local" | "remote";

export type RemoteType = "opencode" | "openwork";

export type ApprovalMode = "manual" | "auto";

export type TokenScope = "owner" | "collaborator" | "viewer";

export type SandboxBackend = "none" | "docker" | "container";

export type ProviderPlacement = "in-sandbox" | "host-machine" | "client-machine" | "external";

export type LogFormat = "pretty" | "json";

export interface WorkspaceConfig {
  id?: string;
  path: string;
  name?: string;
  preset?: string;
  workspaceType?: WorkspaceType;
  remoteType?: RemoteType;
  baseUrl?: string;
  directory?: string;
  displayName?: string;
  openworkHostUrl?: string;
  openworkToken?: string;
  openworkWorkspaceId?: string;
  openworkWorkspaceName?: string;
  sandboxBackend?: string;
  sandboxRunId?: string;
  sandboxContainerName?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  preset: string;
  workspaceType: WorkspaceType;
  remoteType?: RemoteType;
  baseUrl?: string;
  directory?: string;
  displayName?: string;
  openworkHostUrl?: string;
  openworkToken?: string;
  openworkWorkspaceId?: string;
  openworkWorkspaceName?: string;
  sandboxBackend?: string;
  sandboxRunId?: string;
  sandboxContainerName?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  opencode?: {
    baseUrl?: string;
    directory?: string;
    username?: string;
    password?: string;
  };
}

// Compile-time contract tripwires against the shared wire shape consumed by
// apps/app (packages/types/src/workspace.ts). The first check rejects fields
// whose values no longer fit the wire contract; the second rejects fields the
// contract does not know about. Both are erased at build time.
type Extends<A extends B, B> = A;
type _WorkspaceInfoFitsWire = Extends<WorkspaceInfo, WorkspaceWire>;
type _WorkspaceInfoKeysKnown = Extends<keyof WorkspaceInfo, keyof WorkspaceWire>;

export interface OpencodeConfigFile {
  path: string;
  exists: boolean;
  content: string | null;
}

export interface ApprovalConfig {
  mode: ApprovalMode;
  timeoutMs: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  token: string;
  hostToken: string;
  configPath?: string;
  opencodeBaseUrl?: string;
  opencodeDirectory?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  approval: ApprovalConfig;
  corsOrigins: string[];
  workspaces: WorkspaceInfo[];
  authorizedRoots: string[];
  readOnly: boolean;
  startedAt: number;
  tokenSource: "cli" | "env" | "file" | "generated";
  hostTokenSource: "cli" | "env" | "file" | "generated";
  logFormat: LogFormat;
  logRequests: boolean;
  /**
   * When false, the in-process scheduler does not boot and
   * `/api/scheduled/*` returns 503. This lets the desktop app spawn
   * openwork-server WITHOUT the scheduler and rely on a separate
   * orchestrator-hosted scheduler that survives the Electron app
   * closing. Defaults to `true` so existing single-process
   * deployments keep working unchanged.
   */
  enableScheduler: boolean;
}

export interface Capabilities {
  schemaVersion: number;
  serverVersion: string;
  opencodeVersion: string;
  skills: { read: boolean; write: boolean; source: "openwork" | "opencode" };
  hub: {
    skills: {
      read: boolean;
      install: boolean;
      repo: { owner: string; name: string; ref: string };
    };
  };
  plugins: { read: boolean; write: boolean };
  mcp: { read: boolean; write: boolean };
  commands: { read: boolean; write: boolean };
  config: { read: boolean; write: boolean };

  approvals: { mode: ApprovalMode; timeoutMs: number };
  sandbox: { enabled: boolean; backend: SandboxBackend };
  ui: { toy: boolean };
  tokens: { scoped: boolean; scopes: TokenScope[] };
  proxy: {
    opencode: boolean;
  };
  toolProviders: {
    browser: {
      enabled: boolean;
      placement: ProviderPlacement;
      mode: "none" | "headless" | "interactive";
    };
    files: {
      injection: boolean;
      outbox: boolean;
      inboxPath: string;
      outboxPath: string;
      maxBytes: number;
    };
  };
}

export type ReloadReason = "plugins" | "skills" | "mcp" | "config" | "agents" | "commands";

export type ReloadTrigger = {
  type: "skill" | "plugin" | "config" | "mcp" | "agent" | "command";
  name?: string;
  action?: "added" | "removed" | "updated";
  path?: string;
};

export interface ReloadEvent {
  id: string;
  seq: number;
  workspaceId: string;
  reason: ReloadReason;
  trigger?: ReloadTrigger;
  timestamp: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface PluginItem {
  spec: string;
  source: "config" | "dir.project" | "dir.global";
  scope: "project" | "global";
  path?: string;
}

export interface McpItem {
  name: string;
  config: Record<string, unknown>;
  source: "config.project" | "config.global" | "config.remote";
  disabledByTools?: boolean;
}

export interface SkillItem {
  name: string;
  path: string;
  description: string;
  scope: "project" | "global";
  trigger?: string;
  category?: string;
}

export interface HubSkillItem {
  name: string;
  description: string;
  trigger?: string;
  source: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  };
}

export interface CommandItem {
  name: string;
  description?: string;
  template: string;
  agent?: string;
  model?: string | null;
  subtask?: boolean;
  scope: "workspace" | "global";
}

export interface Actor {
  type: "remote" | "host";
  clientId?: string;
  tokenHash?: string;
  scope?: TokenScope;
}

export interface ApprovalRequest {
  id: string;
  workspaceId: string;
  action: string;
  summary: string;
  paths: string[];
  createdAt: number;
  actor: Actor;
}

export interface AuditEntry {
  id: string;
  workspaceId: string;
  actor: Actor;
  action: string;
  target: string;
  summary: string;
  timestamp: number;
}

/**
 * A point-in-time snapshot of a file's content, stored in `runtime.sqlite`
 * (table `file_snapshots`). Used by Phase 6 (Version History) to back the
 * per-file history list, manual "Save snapshot" button, and 1-click restore.
 *
 * Snapshots are deduplicated by `(workspace_id, file_path, content_hash)` via
 * a UNIQUE index — saving the same content twice is a no-op (caller gets the
 * existing row back via `id`).
 */
export type FileSnapshotTrigger = "auto" | "manual" | "agent";

/**
 * Approval status for agent-triggered snapshots. Only meaningful when
 * `trigger === "agent"`. Undefined for legacy rows pre-Phase 6.9 (the
 * approval workflow) and for non-agent triggers.
 *
 *   pending  — AI just edited the file; user has not yet approved or rejected
 *   approved — user accepted; file is now part of the user's working tree
 *   rejected — user rejected; file content was restored to `parentSnapshotId`
 */
export type FileSnapshotStatus = "pending" | "approved" | "rejected";

export interface FileSnapshot {
  id: string;
  workspaceId: string;
  filePath: string;
  contentHash: string;
  /** UTF-8 text content. Binary files are not snapshotted (caller's job to skip). */
  content: string;
  size: number;
  createdAt: number;
  trigger: FileSnapshotTrigger;
  /** Optional `mtimeMs:size` revision from `file-sessions.ts` for cross-referencing. */
  revision: string | null;
  /**
   * Approval status. Only set when `trigger === "agent"`. Older rows
   * (pre-Phase 6.9) and non-agent rows read back as `undefined`.
   */
  status?: FileSnapshotStatus;
  /**
   * Snapshot of the file content immediately *before* the AI edit
   * (`null` for the first snapshot of a file, or when the agent edit
   * has no recorded parent). Restore on reject reads from here.
   */
  parentSnapshotId?: string | null;
}

/* ------------------------------------------------------------------ *
 * Scheduled jobs (Phase 3 / M2)                                      *
 * ------------------------------------------------------------------ */

/**
 * Lifecycle status of a single scheduled-job run.
 *
 * - `pending`     — row created, scheduler has not started it yet.
 * - `running`     — runner is currently executing the prompt.
 * - `success`     — prompt completed without error.
 * - `failed`      — prompt raised an error; `error` column holds the message.
 * - `skipped`     — catch-up window exceeded (server was down too long), see
 *                   plan §4.1 decision 7.
 * - `skipped_overlap` — previous run was still in flight when this one was
 *                   due; see plan §4.1 decision 9.
 */
export type JobRunStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "skipped_overlap";

/**
 * A scheduled cron job. `cronExpression` is parsed by `croner` (5-field POSIX
 * cron, see https://crontab.guru). `timezone` is an IANA tz string, e.g.
 * `"Asia/Tokyo"`. `enabled=0` jobs are kept in DB but not registered with
 * the scheduler.
 */
export interface ScheduledJob {
  id: string;
  workspaceId: string;
  name: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  /**
   * OpenCode agent name used to run this job (e.g. `"build"`, `"plan"`).
   * OpenCode engine treats this as the agent slot for the created session
   * — the prompt is sent under that agent's prompt config.
   */
  agent: string;
  /**
   * Optional OpenCode model override in the form `"providerID/modelID"`
   * (e.g. `"fpt/DeepSeek-V4-Flash"`). When `null`, the runner falls back
   * to the workspace's default model — same as the UI does for ad-hoc
   * sessions. Storing `null` keeps the row stable when the workspace
   * adds new providers.
   */
  model: string | null;
  enabled: boolean;
  /** ms epoch, derived. Updated whenever the schedule changes. */
  nextRunAt: number | null;
  /** ms epoch. Null until the first run completes. */
  lastRunAt: number | null;
  /** ID of the most recent session created by this job. */
  lastRunSessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * One execution attempt of a scheduled job. A job can have many runs over
 * its lifetime; UI shows the most recent 20 in the detail drawer (plan §3.6).
 */
export interface JobRun {
  id: string;
  jobId: string;
  /** When the run was supposed to fire, in job timezone, ms epoch. */
  scheduledFor: number;
  startedAt: number | null;
  finishedAt: number | null;
  status: JobRunStatus;
  sessionId: string | null;
  error: string | null;
}
