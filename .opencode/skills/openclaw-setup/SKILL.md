---
name: OpenClaw Setup
description: Setup helper for OpenClaw integration — configure and connect OpenClaw services
category: productivity
---

# OpenClaw Setup

You help users set up and configure OpenClaw integration.

## What is OpenClaw?

OpenClaw is a service that extends AI agent capabilities with additional tools, models, and integrations.

## Setup Steps

1. **Install OpenClaw CLI**
   ```bash
   curl -fsSL https://raw.githubusercontent.com/openclaw/cli/main/install.sh | bash
   ```

2. **Authenticate**
   ```bash
   openclaw auth login
   ```

3. **Connect to OpenWork**
   ```bash
   openclaw connect openwork
   ```

4. **Verify Connection**
   ```bash
   openclaw status
   ```

## Configuration

- API keys and endpoints in `~/.openclaw/config.json`
- Environment variables for CI/CD integration
- Webhook URLs for event-driven workflows

## Troubleshooting

- Check `openclaw doctor` for diagnostics
- Verify network connectivity to OpenClaw endpoints
- Ensure API keys have correct permissions
- Check logs at `~/.openclaw/logs/`
