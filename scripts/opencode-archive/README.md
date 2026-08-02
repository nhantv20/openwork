# opencode-archive

Rotate old opencode sessions out of the live `opencode.db` into per-session folder archives. The live SQLite stays small, the OpenWork UI becomes cleaner (no more 70+ session entries), and the data remains fully inspectable as JSON / JSONL.

## Why

OpenWork's opencode binary keeps every session in a single SQLite database. After months of use, the DB grows past 250 MB, the OpenWork session picker becomes unwieldy, and the "context bloat" that drives high FPT TPM costs is partly structural (one projectID, all sessions).

This script:

1. Exports every session that has been idle for ≥N days to a per-session folder under `~/.local/share/opencode-archive/YYYY-MM/<sessionId>/`.
2. Marks the session `time_archived` in `opencode.db` so the opencode HTTP API filters it out of the session list (matches opencode's native "archive" UX).
3. After another N days, hard-deletes the session row from `opencode.db` (cascade removes messages + parts + session_input).
4. Runs `VACUUM` to reclaim disk.

## Layout

```
~/.local/share/opencode-archive/
  2026-07/
    ses_xxxxxxxxxxxxx/
      manifest.json          # one-line summary: title, time_*, tokens, project_id, schema_version, ...
      session.json           # full session row (JSON, pretty)
      messages.jsonl         # one row per message, full data column preserved
      parts.jsonl            # one row per part, full data column preserved
      session_input.jsonl    # one row per session_input (currently empty in observed opencode builds)
      attachments/           # copies of tool_<id> files from opencode's tool-output/
        tool_<id>
```

Manifest is written LAST so a half-written folder is detectable as a failed archive (the pruner never deletes without a verified manifest).

## Usage

```bash
# Dry-run: see what would be archived
OPENCODE_ARCHIVE_DAYS=7 bun scripts/opencode-archive/index.ts

# Real run: archive + soft-mark all idle >=7d sessions
bun scripts/opencode-archive/index.ts

# Hard-delete archived sessions soft-marked >=14d ago + VACUUM
OPENCODE_ARCHIVE_HARD_DELETE_DAYS=14 bun scripts/opencode-archive/index.ts

# First-time catch-up: archive all idle + delete all soft-archived
OPENCODE_ARCHIVE_DAYS=0 OPENCODE_ARCHIVE_HARD_DELETE_DAYS=0 bun scripts/opencode-archive/index.ts

# Disable specific steps
OPENCODE_ARCHIVE_NO_HARD_DELETE=1 bun scripts/opencode-archive/index.ts
OPENCODE_ARCHIVE_NO_VACUUM=1 bun scripts/opencode-archive/index.ts
```

## Inspect an archive

```bash
# Summary (manifest)
bun scripts/opencode-archive/restore.ts <sessionId>

# Just session.json
bun scripts/opencode-archive/restore.ts <sessionId> --session

# Just messages.jsonl
bun scripts/opencode-archive/restore.ts <sessionId> --messages

# Just parts.jsonl
bun scripts/opencode-archive/restore.ts <sessionId> --parts

# Everything as one big JSON dump
bun scripts/opencode-archive/restore.ts <sessionId> --all
```

## Run tests

```bash
bun test scripts/opencode-archive/opencode-archive.test.ts
```

5 tests, covers listCandidates, exportSession, hard-delete + VACUUM, listHardDeleteCandidates, main() end-to-end.

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `OPENCODE_DB` | (probed) | Path to live `opencode.db`. Probe order: OpenWork dev path → `$XDG_DATA_HOME/opencode/opencode.db`. |
| `OPENCODE_ARCHIVE_ROOT` | `$XDG_DATA_HOME/opencode-archive` | Where archive folders go. |
| `OPENCODE_DATA_DIR` | (probed) | Used to find `tool-output/` for attachment copying. |
| `OPENCODE_ARCHIVE_DAYS` | `7` | Idle threshold for "archive this session". |
| `OPENCODE_ARCHIVE_HARD_DELETE_DAYS` | `14` | Soft-archived threshold before hard-delete. Set to `0` for first-time catch-up. |
| `OPENCODE_ARCHIVE_DRY_RUN` | `0` | Print plan, write nothing. |
| `OPENCODE_ARCHIVE_NO_HARD_DELETE` | `0` | Skip the hard-delete + VACUUM pass. |
| `OPENCODE_ARCHIVE_NO_VACUUM` | `0` | Skip the VACUUM call. |

## Behavior

- **Idle filter**: `time_updated < (now - idleDays)` AND no message newer than the cutoff. A session with old data but recent pings is left alone.
- **Already-archived**: if the target folder exists, the session is skipped (with `skipped` in the report) — never overwrites an existing completed archive.
- **Hard-delete safety**: refuses to delete if no archive folder exists. If you accidentally deleted the archive, the session is "soft-archived" but recoverable.
- **VACUUM**: takes ~2s on a 250 MB DB, reclaiming ~13 MB per 23 archived sessions.
- **opencode still works**: verified end-to-end. `curl http://.../global/health` returns `{"healthy":true}` immediately after the run.

## Verified

23 sessions archived + hard-deleted from a real `opencode.db` (248 MB → 236 MB) with 0 failed, 0 refused. OpenWork UI now sees 48 active sessions instead of 71. The 23 archived sessions remain available as JSON / JSONL on disk.
