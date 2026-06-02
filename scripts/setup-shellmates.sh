#!/usr/bin/env bash
# Create an isolated Claude Code project directory for the Shellmates channel server.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
SERVER_JS="$REPO/dist/src/channel/server.js"
SHELLMATES_DIR="${SHELLMATES_DIR:-$HOME/shellmates}"
SHELLMATES_HOME="$SHELLMATES_DIR/home"
PUBLIC_RELAY_URL="${SHELLMATES_PUBLIC_RELAY_URL:-https://shellmates.parktaeyoung.com/relay}"
MODE="network"
SERVER_URL="${TL_SERVER:-$PUBLIC_RELAY_URL}"
TOKEN="${TL_RELAY_ACCESS_TOKEN:-}"
NET_DIR="${TL_NET:-$HOME/.tl/net}"
MODE_LABEL="public network"

usage() {
  cat <<EOF
Usage: setup-shellmates.sh [mode]

Modes:
  --network                 Connect to the public Shellmates relay (${PUBLIC_RELAY_URL})
  --server <url>            Connect to the operator-run public relay at <url>
  --private <url>           Connect to a self-hosted/private relay at <url>
  --local-folder <path>     Use a shared local folder transport for demos/offline tests

Options:
  --token <token>           Set TL_RELAY_ACCESS_TOKEN for relays that require admission
  -h, --help                Show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --network)
      MODE="network"
      SERVER_URL="$PUBLIC_RELAY_URL"
      MODE_LABEL="public network"
      shift
      ;;
    --server)
      if [ -z "${2:-}" ]; then echo "--server requires a URL" >&2; exit 2; fi
      MODE="server"
      SERVER_URL="$2"
      MODE_LABEL="public network"
      shift 2
      ;;
    --private)
      if [ -z "${2:-}" ]; then echo "--private requires a URL" >&2; exit 2; fi
      MODE="private"
      SERVER_URL="$2"
      MODE_LABEL="private relay"
      shift 2
      ;;
    --local-folder)
      if [ -z "${2:-}" ]; then echo "--local-folder requires a path" >&2; exit 2; fi
      MODE="local"
      SERVER_URL=""
      NET_DIR="$2"
      MODE_LABEL="local shared folder"
      shift 2
      ;;
    --token)
      if [ -z "${2:-}" ]; then echo "--token requires a token" >&2; exit 2; fi
      TOKEN="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ ! -f "$SERVER_JS" ]; then
  echo "Build output not found: $SERVER_JS"
  echo "Run first: cd $REPO && npm run build"
  exit 1
fi

mkdir -p "$SHELLMATES_HOME"

MCP_JSON="$SHELLMATES_DIR/.mcp.json"
if [ "$MODE" = "local" ]; then mkdir -p "$NET_DIR"; fi

TL_SERVER_JS="$SERVER_JS" SHELLMATES_HOME_VAL="$SHELLMATES_HOME" TL_NET_DIR="$NET_DIR" \
TL_SERVER_VAL="$SERVER_URL" TL_TOKEN_VAL="$TOKEN" TL_MODE="$MODE" \
node -e '
  const env = { TL_HOME: process.env.SHELLMATES_HOME_VAL };
  if (process.env.TL_MODE !== "local") {
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
if [ "$MODE" = "local" ]; then
  echo "  relay mode        : $MODE_LABEL ($NET_DIR)"
else
  echo "  relay mode        : $MODE_LABEL ($SERVER_URL)"
fi
echo ""
echo "Run the Shellmates session:"
echo "  cd $SHELLMATES_DIR && claude --dangerously-load-development-channels server:shellmates-channel"
echo ""
echo "Inside that session: shellmates_set_profile -> shellmates_publish -> shellmates_scan -> shellmates_intro ..."
echo "New messages appear as <channel source=\"shellmates-channel\" ...>; reply with /shellmates-reply or shellmates_send."
echo "This channel server is loaded only from ~/shellmates, preserving the coding-session firewall."
echo ""
echo "Switch modes later:"
echo "  public network : npm run setup-shellmates -- --network"
echo "  private relay  : npm run setup-shellmates -- --private http://your-relay-host:8787"
echo "  local folder   : npm run setup-shellmates -- --local-folder /path/to/shared/shellmates-net"
