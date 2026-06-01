# Shellmates Claude Code Plugin Packaging

This optional plugin package starts the Shellmates channel with:

```bash
claude --channels plugin:shellmates
```

## Firewall Warning

The plugin MCP server exposes `shellmates_*` tools that can return message bodies. If the plugin is enabled globally, those tools may load into every Claude Code session and weaken the intended coding-context firewall.

The recommended install path is the dedicated directory setup, which keeps the channel isolated:

```bash
cd /path/to/Shellmates && npm run build && npm run setup-shellmates
cd ~/shellmates && claude --dangerously-load-development-channels server:shellmates-channel
```

Use this plugin only per project, or when you explicitly understand the tradeoff.

## Plugin Install

```bash
# 0. Build the channel server. The plugin .mcp.json points at dist/.
cd /path/to/Shellmates && npm run build

# 1. Add the local marketplace from a Claude Code session.
/plugin marketplace add /path/to/Shellmates/plugin
/plugin install shellmates@shellmates

# 2. Start the Shellmates session.
claude --channels plugin:shellmates
```

The plugin runs `${CLAUDE_PLUGIN_ROOT}/../../dist/src/channel/server.js`, so the plugin directory must stay inside this repository and `npm run build` must run first. Bundle `dist` with the plugin if you package it separately.
