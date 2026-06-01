# Shellmates

![Shellmates human-to-human chat with agent assistance](docs/assets/terminallove-readme-hero.png)

Open-source people-to-people messaging for Claude Code, assisted by local coding agents.

Shellmates helps people meet and talk through their coding agents. Your agent can help draft a public profile, surface compatible people, keep the chat encrypted, and suggest reply direction, but the conversation is between humans. Ordinary coding sessions only see count-only status, so private chat does not leak into coding context.

The product UI, tools, commands, and docs are English. The actual conversation can be in any language the users choose.

## Why

Coding agents already understand a lot about the work their humans are doing. Shellmates turns that context into a local-first way for people to meet, collaborate, or keep a focused 1:1 chat without copying private project context into a public app.

Shellmates is not an autonomous agent chatroom. It is a context-firewalled human messenger with agent assistance:

- The coding session stays clean.
- The Shellmates session handles human message bodies and reply coaching.
- The relay cannot read message contents.
- Users decide exactly what gets sent.

## Features

- **Local-first human profile**: private state stays under `TL_HOME`; only signed public profile cards are published.
- **Signed agent identity**: `agent_id = fingerprint(sign_pub)` using Ed25519.
- **End-to-end encrypted messages**: X25519 ECDH, HKDF, AES-256-GCM.
- **Live Claude Code channel**: inbound messages appear as `<channel source="shellmates-channel" ...>`.
- **Context firewall**: ordinary coding MCP tools never return message bodies or coaching.
- **One active 1:1 chat**: simpler safety model; end the current chat before starting another.
- **Reply coaching**: helps the person choose tone, intent, and question direction instead of sending messages automatically.
- **Local or network transport**: shared-folder mode by default; HTTP relay/directory with `TL_SERVER`.
- **Command and skill affordances**: `/shellmates-*` commands and a `shellmates` skill map user intent to `shellmates_*` MCP tools.

## Requirements

- Node.js 20+
- Claude Code for live channel sessions
- macOS is best supported for the `/shellmates` Terminal launcher

## Quick Start

```bash
git clone <repo-url>
cd Shellmates
npm install
npm run build
npm test
npm run demo
```

If you are working from this local checkout before the folder is renamed, use:

```bash
cd /Users/taeyoungpark/Desktop/TerminalLove
```

## Install Claude Code Commands And Skill

```bash
npm run install-agent
```

This installs:

- `~/.claude/commands/shellmates*.md`
- `~/.agents/skills/shellmates/SKILL.md`
- `~/shellmates/.mcp.json` with `shellmates-channel`

Restart Claude Code or open a new session after installation.

## Open The Shellmates Session

Run:

```bash
cd ~/shellmates
claude --dangerously-load-development-channels server:shellmates-channel
```

This is the isolated session where message bodies and coaching are allowed.

Inside that session, common tools are:

- `shellmates_status`
- `shellmates_set_profile`
- `shellmates_publish`
- `shellmates_scan`
- `shellmates_intro`
- `shellmates_inbox`
- `shellmates_accept`
- `shellmates_open`
- `shellmates_coach`
- `shellmates_send`
- `shellmates_end`
- `shellmates_block`
- `shellmates_report`

## Slash Commands

After `npm run install-agent`, Claude Code gets these commands:

- `/shellmates`: open or focus the isolated Shellmates session
- `/shellmates-status`: check profile, active chat, unread count, and pending intros
- `/shellmates-open`: open the current chat and get reply direction
- `/shellmates-scan`: search people who may be good matches
- `/shellmates-intro`: send an intro to a selected candidate
- `/shellmates-reply`: get reply direction or send exact user-provided text
- `/shellmates-profile`: check, create, or publish a profile

## Thin MCP For Coding Sessions

Ordinary coding sessions should use only the thin MCP server:

```bash
claude mcp add --scope user shellmates -- node /absolute/path/Shellmates/dist/src/mcp/server.js
```

It exposes only:

- `shellmates_status`
- `shellmates_open_session`

These tools are count-only and body-free. Do not register the full/channel server globally in coding sessions.

## CLI

You can also use Shellmates as a CLI in a separate terminal:

```bash
export TL_HOME="$HOME/.shellmates/me"
export TL_NET="$HOME/.shellmates-net"

npm run cli -- init
npm run cli -- profile --name Alice --country Korea \
  --langs "Korean,English" \
  --stacks "TypeScript,Rust" \
  --interests "Developer Tools,Open Source" \
  --modes "builder,friend"
npm run cli -- publish
npm run cli -- scan
npm run cli -- intro <agent_id> "Hi, I saw you are also building developer tools."
npm run cli -- inbox
npm run cli -- accept <intro_id>
npm run cli -- open
npm run cli -- send "Nice to meet you."
npm run cli -- reply
```

Run `npm run cli` with no arguments for the REPL. JSON output redacts message bodies and coaching unless `--include-bodies` is set.

## Local Two-Person Smoke

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

Continue with the scanned `agent_id`:

```bash
TL_HOME="$ROOT/alice" TL_NET="$NET" npm run cli -- intro <bob_agent_id> "Hi Bob."
TL_HOME="$ROOT/bob" TL_NET="$NET" npm run cli -- inbox
TL_HOME="$ROOT/bob" TL_NET="$NET" npm run cli -- accept <intro_id>
TL_HOME="$ROOT/alice" TL_NET="$NET" npm run cli -- open
TL_HOME="$ROOT/alice" TL_NET="$NET" npm run cli -- send "Nice to meet you."
TL_HOME="$ROOT/bob" TL_NET="$NET" npm run cli -- open
```

## Network Relay

Start a relay/directory server:

```bash
TL_RELAY_ACCESS_TOKEN=devtoken npm run server
```

Connect a client:

```bash
export TL_SERVER=http://127.0.0.1:8787
export TL_RELAY_ACCESS_TOKEN=devtoken
npm run cli -- publish
```

Docker:

```bash
docker build -t shellmates-relay .
docker run -p 8787:8787 -e TL_RELAY_ACCESS_TOKEN=devtoken shellmates-relay
```

## Security Model

| Risk | Shellmates defense |
| --- | --- |
| Impersonation | Ed25519 signatures and owner/signing-key binding |
| Message tampering | Signed envelopes |
| Replay | Envelope id dedupe and signed timestamps |
| Unmatched DMs | Intro-first flow; messages outside active chat are rejected |
| Profile tampering | Signed profile cards with expiry |
| Prompt injection | Peer text is untrusted, sanitized, and flagged |
| Coding-context leakage | Bodies/coaching only appear in the isolated Shellmates session |
| Relay eavesdropping | E2E encryption; relay stores ciphertext |

## Development

```bash
npm run typecheck
npm test
npm run build
node scripts/e2e-channel.mjs
```

Current verification target:

- Typecheck
- 100/100 tests
- Build
- Real stdio channel e2e

## Repository Hygiene

Do not commit local identity, relay, generated build, or planning artifacts:

- `dist/`
- `node_modules/`
- `serverData/`
- `.claude/`
- `.antigravitycli/`
- `MEMORY.md`
- `PLAN*.md`
- local product-planning docs
- generated landing files

The public repository should contain runtime source, tests, install scripts, command/skill definitions, plugin packaging, Docker assets, and this README.

## License

MIT
