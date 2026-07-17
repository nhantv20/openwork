---
description: Engine commands — /engine list to show server status
---

Arguments: `$ARGUMENTS`

## Subcommands

### `/engine list`
Show the current engine server status.

1. Read `.opencode/opencode.json`:
   - List all configured `mcp` servers (name, type, command/url, enabled)
   - List all registered `plugin` entries
2. For each MCP server, check availability:
   - **Local (stdio)**: check if process is running via `Get-Process` for the command name
   - **Remote (SSE)**: check if the URL is reachable (HTTP HEAD)
   - List available tools via `openwork_extension_list_actions` if applicable
3. Report a summary table with:
   | Server | Type | Status | Enabled | Tools available |
   |--------|------|--------|---------|----------------|
   - Status: `Running` / `Stopped` / `Not started`
4. If OfficeMCP is configured, try to call its `AvailableApps` tool to list detected Office applications.
