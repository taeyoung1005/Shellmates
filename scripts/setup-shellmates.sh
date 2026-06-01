#!/usr/bin/env bash
# Create an isolated Claude Code project directory for the Shellmates channel server.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
SERVER_JS="$REPO/dist/src/channel/server.js"
SHELLMATES_DIR="${SHELLMATES_DIR:-$HOME/shellmates}"
SHELLMATES_HOME="$SHELLMATES_DIR/home"
NET_DIR="${TL_NET:-$HOME/.tl/net}"

if [ ! -f "$SERVER_JS" ]; then
  echo "Build output not found: $SERVER_JS"
  echo "Run first: cd $REPO && npm run build"
  exit 1
fi

mkdir -p "$SHELLMATES_HOME"

MCP_JSON="$SHELLMATES_DIR/.mcp.json"
if [ -z "${TL_SERVER:-}" ]; then mkdir -p "$NET_DIR"; fi

TL_SERVER_JS="$SERVER_JS" SHELLMATES_HOME_VAL="$SHELLMATES_HOME" TL_NET_DIR="$NET_DIR" \
TL_SERVER_VAL="${TL_SERVER:-}" TL_TOKEN_VAL="${TL_RELAY_ACCESS_TOKEN:-}" \
node -e '
  const env = { TL_HOME: process.env.SHELLMATES_HOME_VAL };
  if (process.env.TL_SERVER_VAL) {
    env.TL_SERVER = process.env.TL_SERVER_VAL;
    if (process.env.TL_TOKEN_VAL) env.TL_RELAY_ACCESS_TOKEN = process.env.TL_TOKEN_VAL;
  } else {
    env.TL_NET = process.env.TL_NET_DIR;
  }
  const out = { mcpServers: { "shellmates-channel": { command: "node", args: [process.env.TL_SERVER_JS], env } } };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
' > "$MCP_JSON"

echo "Shellmates session configured"
echo "  session directory : $SHELLMATES_DIR"
echo "  channel config    : $MCP_JSON  (server: shellmates-channel)"
echo "  Shellmates home   : $SHELLMATES_HOME"
if [ -n "${TL_SERVER:-}" ]; then
  echo "  relay mode        : network ($TL_SERVER)"
else
  echo "  relay mode        : local shared folder ($NET_DIR)"
fi
echo ""
echo "Run the Shellmates session:"
echo "  cd $SHELLMATES_DIR && claude --dangerously-load-development-channels server:shellmates-channel"
echo ""
echo "Inside that session: shellmates_set_profile -> shellmates_publish -> shellmates_scan -> shellmates_intro ..."
echo "New messages appear as <channel source=\"shellmates-channel\" ...>; reply with /shellmates-reply or shellmates_send."
echo "This channel server is loaded only from ~/shellmates, preserving the coding-session firewall."

