# Shellmates

<p align="center">
  <img src="docs/assets/shellmates-logo.png" alt="Shellmates logo" width="520">
</p>

![Shellmates human-to-human chat with agent assistance](docs/assets/terminallove-readme-hero.png)

Open-source people-to-people messaging for Claude Code, assisted by local coding agents.

Shellmates helps people meet and talk through their coding agents. Your agent can help draft a public profile, surface compatible people, keep the chat encrypted, and suggest reply direction, but the conversation is between humans. The main experience runs in an isolated Shellmates session, so private chat does not leak into ordinary coding context.

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
- **Public or private relay transport**: global matching uses the operator-run HTTP relay; teams can self-host a private relay or use a local shared folder for demos.
- **Command and skill affordances**: `/shellmates-*` commands and a `shellmates` skill map user intent to `shellmates_*` MCP tools.

## Requirements

- Node.js 20+
- Claude Code for live channel sessions
- macOS is best supported for the `/shellmates` Terminal launcher

## Quick Start

First run:

```bash
npx -y @taeyoung1005/shellmates start
```

This creates the isolated Shellmates session under `~/shellmates`, connects it to the public relay, and opens it.

If you close the Terminal window, reopen the same session:

```bash
npx -y @taeyoung1005/shellmates open
```

The public landing page and relay API can share one host:

- `https://shellmates.parktaeyoung.com` serves the landing page.
- `https://shellmates.parktaeyoung.com/relay` is the Shellmates relay API base URL.

For a private team, company, or friend-group network, run your own relay and point each client at it:

```bash
TL_RELAY_HOST=0.0.0.0 TL_RELAY_ACCESS_TOKEN=devtoken npx -y @taeyoung1005/shellmates sm-relay
npx -y @taeyoung1005/shellmates start --private http://your-relay-host:8787 --token devtoken
```

For a same-machine or shared-filesystem demo, use local folder mode:

```bash
npx -y @taeyoung1005/shellmates start --local-folder "$HOME/.shellmates-net"
```

## What Gets Installed

Shellmates uses a local MCP channel server plus a remote or private relay:

- `npx -y @taeyoung1005/shellmates start` writes `~/shellmates/.mcp.json` and opens the session.
- The generated MCP config runs `npx -y @taeyoung1005/shellmates sm-channel --server https://shellmates.parktaeyoung.com/relay`.
- `npx -y @taeyoung1005/shellmates open` opens `claude --dangerously-load-development-channels server:shellmates-channel`.
- Your identity, keys, and chat state stay under `~/shellmates/home`.
- The relay stores signed public profiles and encrypted relay envelopes; it cannot read message bodies.

You can split setup and open for debugging:

```bash
npx -y @taeyoung1005/shellmates setup --server https://shellmates.parktaeyoung.com/relay
npx -y @taeyoung1005/shellmates open
```

## Open The Shellmates Session

Run:

```bash
npx -y @taeyoung1005/shellmates open
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

If you install the optional local slash commands from a source checkout, Claude Code gets these commands:

- `/shellmates`: open or focus the isolated Shellmates session
- `/shellmates-status`: check profile, active chat, unread count, and pending intros
- `/shellmates-open`: open the current chat and get reply direction
- `/shellmates-scan`: search people who may be good matches
- `/shellmates-intro`: send an intro to a selected candidate
- `/shellmates-reply`: get reply direction or send exact user-provided text
- `/shellmates-profile`: check, create, or publish a profile

## CLI Chat Commands

You can also use Shellmates as a CLI in a separate terminal:

```bash
export TL_HOME="$HOME/.shellmates/me"
export TL_SERVER="https://shellmates.parktaeyoung.com/relay"

npx -y @taeyoung1005/shellmates chat init
npx -y @taeyoung1005/shellmates chat profile --name Alice --country Korea \
  --langs "Korean,English" \
  --stacks "TypeScript,Rust" \
  --interests "Developer Tools,Open Source" \
  --modes "builder,friend"
npx -y @taeyoung1005/shellmates chat publish
npx -y @taeyoung1005/shellmates chat scan
npx -y @taeyoung1005/shellmates chat intro <agent_id> "Hi, I saw you are also building developer tools."
npx -y @taeyoung1005/shellmates chat inbox
npx -y @taeyoung1005/shellmates chat accept <intro_id>
npx -y @taeyoung1005/shellmates chat open
npx -y @taeyoung1005/shellmates chat send "Nice to meet you."
npx -y @taeyoung1005/shellmates chat reply
```

Run `npx -y @taeyoung1005/shellmates chat` with no arguments for the REPL. JSON output redacts message bodies and coaching unless `--include-bodies` is set.

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

## Development From Source

Use this path only when contributing to Shellmates itself:

```bash
git clone <repo-url>
cd Shellmates
npm install
npm run build
npm test
npm run demo
npm run install-agent
```

## Private Relay

Start a relay/directory server for a private network:

```bash
TL_RELAY_HOST=0.0.0.0 TL_RELAY_ACCESS_TOKEN=devtoken npx -y @taeyoung1005/shellmates sm-relay
```

Connect a client:

```bash
export TL_SERVER=http://your-relay-host:8787
export TL_RELAY_ACCESS_TOKEN=devtoken
npx -y @taeyoung1005/shellmates chat publish
```

Docker:

```bash
docker build -t shellmates-relay .
docker run -p 8787:8787 -e TL_RELAY_ACCESS_TOKEN=devtoken shellmates-relay
```

If you mount the relay under a path such as `/relay`, set:

```bash
TL_RELAY_BASE_PATH=/relay TL_RELAY_HOST=0.0.0.0 npx -y @taeyoung1005/shellmates sm-relay
```

Then point clients at the mounted base URL:

```bash
npx -y @taeyoung1005/shellmates start --server https://shellmates.parktaeyoung.com/relay
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
