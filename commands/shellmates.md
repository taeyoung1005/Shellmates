---
description: Open the isolated Shellmates channel session in a separate terminal
---

Shellmates conversations happen in a separate channel session:
`claude --dangerously-load-development-channels server:shellmates-channel`.

The launcher output below is setup/status guidance only. It must not include message bodies or coaching.

!`bash /Users/taeyoungpark/Desktop/TerminalLove/scripts/shellmates.sh 2>&1 || echo "Launcher not found. Open manually with: cd ~/shellmates && claude --dangerously-load-development-channels server:shellmates-channel. If it is not set up yet, run: cd /Users/taeyoungpark/Desktop/TerminalLove && npm run setup-shellmates."`

If a new Shellmates session opened, continue there:
- New messages appear as live `<channel source="shellmates-channel" ...>` notifications.
- Send replies with `shellmates_send`.
- Open the current chat with `shellmates_open`.
- Search and start new matches with `shellmates_scan` then `shellmates_intro`.

Important: Shellmates message bodies and coaching are shown only in that isolated channel session. They are intentionally unavailable in this coding session to preserve the context firewall.

