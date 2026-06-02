#!/usr/bin/env node
// Shellmates MCP server: thin and context-safe.
// The coding-session MCP never exposes message bodies or coaching.
// It returns only notification counts/events/aliases and instructions for opening the separate session.
import { isMainEntry } from "../core/entry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Engine } from "../core/engine.js";
import { applyChannelArgs } from "../channel/server.js";

export function buildServer(): McpServer {
  const server = new McpServer({ name: "shellmates", version: "0.1.1" });

  server.registerTool(
    "shellmates_status",
    {
      title: "Shellmates status (counts only)",
      description:
        "Returns Shellmates notification counts, events, and sender aliases only. It never includes message bodies or coaching.",
      inputSchema: {},
    },
    async () => {
      const engine = Engine.open();
      if (!engine.agentId) {
        return { content: [{ type: "text", text: "Shellmates: no identity yet. Run `shellmates init` in the separate session." }] };
      }
      const n = engine.notificationState();
      const s = engine.status();
      const text = `unread=${n.unread} · last_event=${n.last_event ?? "-"} · from=${n.last_from_alias ?? "-"} · active_chat=${s.active_partner ? "yes" : "no"} · inbox=${s.inbox}`;
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "shellmates_open_session",
    {
      title: "How to open Shellmates",
      description:
        "Shellmates conversations happen in a separate session outside the coding context. This tool returns open instructions only, never conversation content.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "Open a separate terminal and run `shellmates` or `sm`. Message bodies and coaching are intentionally not shown in this coding session.",
        },
      ],
    }),
  );

  return server;
}

export async function runThinMcpServer(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  applyChannelArgs(argv, env);
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Shellmates MCP (thin, context-safe) connected via stdio.\n");
}

const isMain = isMainEntry(import.meta.url);
if (isMain) {
  runThinMcpServer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
