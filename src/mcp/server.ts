#!/usr/bin/env node
// TerminalLove MCP 서버 — thin & 컨텍스트-세이프.
// 컨텍스트 방화벽(§10.4): 메인 코딩 세션에 붙는 이 MCP는 메시지 본문/코칭을 절대 노출하지 않는다.
// 오직 (1) 알림 카운트/이벤트/발신 alias, (2) 별도 세션을 여는 방법 안내만 제공한다.
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Engine } from "../core/engine.js";

export function buildServer(): McpServer {
  const server = new McpServer({ name: "terminallove", version: "0.1.0" });

  server.registerTool(
    "terminallove_status",
    {
      title: "TerminalLove 상태(카운트만)",
      description:
        "TerminalLove 알림 카운트/이벤트/발신 alias 만 반환합니다. 메시지 본문·코칭은 포함하지 않습니다(컨텍스트 방화벽). 소개팅 대화 내용은 이 코딩 세션에 절대 들어오지 않습니다.",
      inputSchema: {},
    },
    async () => {
      const engine = Engine.open();
      if (!engine.agentId) {
        return { content: [{ type: "text", text: "TerminalLove: 신원 없음. 별도 세션에서 `tl init` 하세요." }] };
      }
      const n = engine.notificationState();
      const s = engine.status();
      const text = `unread=${n.unread} · last_event=${n.last_event ?? "-"} · from=${n.last_from_alias ?? "-"} · active_chat=${s.active_partner ? "yes" : "no"} · inbox=${s.inbox}`;
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "terminallove_open_session",
    {
      title: "TerminalLove 세션 여는 법",
      description:
        "TerminalLove 대화는 코딩 컨텍스트와 분리된 별도 세션에서 진행합니다. 이 도구는 여는 방법 안내만 반환하며 대화 내용은 포함하지 않습니다.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "별도 터미널에서 `npm run cli`(또는 `tl`)를 실행해 대화하세요. 메시지 본문·코칭은 컨텍스트 방화벽 정책상 이 코딩 세션에 표시되지 않습니다.",
        },
      ],
    }),
  );

  return server;
}

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("TerminalLove MCP (thin, context-safe) connected via stdio.\n");
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
