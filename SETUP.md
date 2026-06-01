# Shellmates Setup And Test Guide

This checkout currently lives at:

```bash
/Users/taeyoungpark/Desktop/TerminalLove
```

The product/runtime name is Shellmates. The physical folder name has not been renamed.

## Install

```bash
cd /Users/taeyoungpark/Desktop/TerminalLove
npm install
npm run build
npm run install-agent
```

`install-agent` installs:

- `~/.claude/commands/shellmates*.md`
- `~/.agents/skills/shellmates/SKILL.md`
- `~/shellmates/.mcp.json` with `shellmates-channel`

Restart Claude Code or open a new session after installation.

## Open The Shellmates Channel Session

```bash
cd ~/shellmates
claude --dangerously-load-development-channels server:shellmates-channel
```

This is the only session where message bodies and coaching should appear.

## Thin MCP For Coding Sessions

Use this only when you want count-only status in an ordinary coding session:

```bash
claude mcp add --scope user shellmates -- node /Users/taeyoungpark/Desktop/TerminalLove/dist/src/mcp/server.js
```

Exposed tools:

- `shellmates_status`
- `shellmates_open_session`

These tools do not expose message bodies or coaching.

## Two-Identity Local Smoke

```bash
ROOT="$(mktemp -d)"
NET="$ROOT/net"

TL_HOME="$ROOT/alice" TL_NET="$NET" npm run cli -- init
TL_HOME="$ROOT/alice" TL_NET="$NET" npm run cli -- profile --name Alice --country Korea --langs "Korean,English" --stacks "TypeScript" --interests "Developer Tools" --modes "builder,friend"
TL_HOME="$ROOT/alice" TL_NET="$NET" npm run cli -- publish

TL_HOME="$ROOT/bob" TL_NET="$NET" npm run cli -- init
TL_HOME="$ROOT/bob" TL_NET="$NET" npm run cli -- profile --name Bob --country Spain --langs "English,Spanish" --stacks "Rust" --interests "Developer Tools" --modes "builder,friend"
TL_HOME="$ROOT/bob" TL_NET="$NET" npm run cli -- publish

TL_HOME="$ROOT/alice" TL_NET="$NET" npm run cli -- scan
```

Use the scanned `agent_id` to continue:

```bash
TL_HOME="$ROOT/alice" TL_NET="$NET" npm run cli -- intro <bob_agent_id> "Hi Bob."
TL_HOME="$ROOT/bob" TL_NET="$NET" npm run cli -- inbox
TL_HOME="$ROOT/bob" TL_NET="$NET" npm run cli -- accept <intro_id>
TL_HOME="$ROOT/alice" TL_NET="$NET" npm run cli -- open
TL_HOME="$ROOT/alice" TL_NET="$NET" npm run cli -- send "Nice to meet you."
TL_HOME="$ROOT/bob" TL_NET="$NET" npm run cli -- open
```

## Network Relay Smoke

```bash
TL_RELAY_ACCESS_TOKEN=devtoken npm run server
```

In another terminal:

```bash
export TL_SERVER=http://127.0.0.1:8787
export TL_RELAY_ACCESS_TOKEN=devtoken
npm run demo:net
```

## Verification

```bash
npm run typecheck
npm test
npm run build
node scripts/e2e-channel.mjs
```

## Notes

- `TL_HOME` controls the local identity/chat state.
- `TL_NET` controls the local shared directory/relay path.
- `TL_SERVER` switches clients to the HTTP relay/directory server.
- `SHELLMATES_DIR` changes the isolated Claude Code project directory; default is `~/shellmates`.
- The Shellmates UI and system text are English. Chat content is human-to-human and can be in any language the users choose.
