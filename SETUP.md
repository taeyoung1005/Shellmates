# Shellmates Setup And Test Guide

This checkout currently lives at:

```bash
/Users/taeyoungpark/Desktop/TerminalLove
```

The product/runtime name is Shellmates. The physical folder name has not been renamed.

## Install

```bash
npx -y @taeyoung1005/shellmates start
```

This configures and opens the isolated Claude Code channel session. By default it connects to the public Shellmates relay at `https://shellmates.parktaeyoung.com/relay`.

To configure without opening:

```bash
npx -y @taeyoung1005/shellmates setup --server https://shellmates.parktaeyoung.com/relay
```

To open an already configured session:

```bash
npx -y @taeyoung1005/shellmates open
```

## Relay Modes

Public network:

```bash
npx -y @taeyoung1005/shellmates start --server https://shellmates.parktaeyoung.com/relay
```

This is the right mode when users want global matching through the operator-run relay.
The landing page can live at `https://shellmates.parktaeyoung.com`, while the relay API is mounted at `https://shellmates.parktaeyoung.com/relay`.

For a private team or company network, self-host a relay and configure each client:

```bash
TL_RELAY_HOST=0.0.0.0 TL_RELAY_ACCESS_TOKEN=devtoken npx -y @taeyoung1005/shellmates sm-relay
npx -y @taeyoung1005/shellmates start --private http://your-relay-host:8787 --token devtoken
```

For a same-machine or shared-folder demo, keep the transport local:

```bash
npx -y @taeyoung1005/shellmates start --local-folder "$HOME/.shellmates-net"
```

## Open The Shellmates Channel Session

`npx -y @taeyoung1005/shellmates open` runs `claude --dangerously-load-development-channels server:shellmates-channel` from `~/shellmates`.

This is the only session where message bodies and coaching should appear.

## Thin MCP For Coding Sessions

Use this only when you want count-only status in an ordinary coding session:

```bash
claude mcp add shellmates -- npx -y @taeyoung1005/shellmates sm-mcp --server https://shellmates.parktaeyoung.com/relay
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

## Development From Source

Use this path only when contributing to Shellmates itself:

```bash
cd /Users/taeyoungpark/Desktop/TerminalLove
npm install
npm run build
npm run install-agent
```

`install-agent` installs local source-checkout commands and skill files:

- `~/.claude/commands/shellmates*.md`
- `~/.agents/skills/shellmates/SKILL.md`
- `~/shellmates/.mcp.json` with `shellmates-channel`

Restart Claude Code or open a new session after installation.

## Private Relay Smoke

```bash
TL_RELAY_HOST=0.0.0.0 TL_RELAY_ACCESS_TOKEN=devtoken npm run server
```

To mount that server below `/relay`, add:

```bash
TL_RELAY_BASE_PATH=/relay TL_RELAY_HOST=0.0.0.0 TL_RELAY_ACCESS_TOKEN=devtoken npm run server
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
- `TL_SERVER` connects a client to the public or private HTTP relay/directory server.
- `TL_RELAY_BASE_PATH` mounts the relay API below a path such as `/relay`.
- `TL_NET` controls the local shared directory/relay path for offline demos.
- `SHELLMATES_PUBLIC_RELAY_URL` overrides the default public relay URL used by `shellmates setup` and `shellmates start`.
- `SHELLMATES_DIR` changes the isolated Claude Code project directory; default is `~/shellmates`.
- The Shellmates UI and system text are English. Chat content is human-to-human and can be in any language the users choose.
