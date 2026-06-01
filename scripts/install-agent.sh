#!/usr/bin/env bash
# Shellmates installer for Claude Code commands, agent skill, and isolated channel session setup.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"

CC_DIR="$HOME/.claude/commands"
mkdir -p "$CC_DIR"
cp "$REPO"/commands/*.md "$CC_DIR/"

SKILL_DIR="$HOME/.agents/skills/shellmates"
mkdir -p "$SKILL_DIR"
cp "$REPO/agents/skills/shellmates/SKILL.md" "$SKILL_DIR/SKILL.md"

if [ -f "$REPO/dist/src/channel/server.js" ]; then
  bash "$REPO/scripts/setup-shellmates.sh" || true
else
  echo "Warning: build output was not found. Run 'npm run build && npm run setup-shellmates' to create the Shellmates session config."
fi

# Remove old TerminalLove/dating command and skill installs if present.
rm -f "$HOME/.claude/commands"/dating*.md 2>/dev/null || true
rm -rf "$HOME/.agents/skills/dating" 2>/dev/null || true
rm -f "$HOME/.codex/prompts/dating.md" "$HOME/.codex/prompts/shellmates.md" 2>/dev/null || true
rm -f "$HOME/.codex/commands/dating.md" "$HOME/.codex/commands/shellmates.md" 2>/dev/null || true

echo "Shellmates install complete (Claude Code only)"
echo "  /shellmates command : $CC_DIR/shellmates.md"
echo "  /shellmates-* commands: $CC_DIR/shellmates-{status,open,scan,intro,reply,profile}.md"
echo "  shellmates skill    : $SKILL_DIR/SKILL.md"
echo "  Shellmates session  : cd ~/shellmates && claude --dangerously-load-development-channels server:shellmates-channel"
echo "Restart Claude Code or open a new session to load /shellmates."

