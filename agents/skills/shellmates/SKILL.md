---
name: "shellmates"
description: "Open Shellmates sessions and map human match search, profile, open, coaching, reply, and send requests to shellmates_* MCP tools."
---

# shellmates

Use this skill when the user wants to open Shellmates, search for people to meet, set up a profile, open a chat, get reply guidance, or send a message.

Human conversation bodies and coaching belong only in the isolated Shellmates channel session, not in ordinary coding sessions.

## Open The Session

When the user asks to open Shellmates from a coding session, run:

```bash
bash /Users/taeyoungpark/Desktop/Shellmates/scripts/shellmates.sh
```

Show only the launcher output. It contains setup/status guidance only, never message bodies or coaching.

## Tool Mapping

Inside the Shellmates channel session, use these MCP tools directly:

- Status: `shellmates_status`
  - Check profile state, publish state, active chat, unread count, and pending intros.
- Open chat: `shellmates_open`
  - Show the original incoming text first, then briefly summarize the flow and reply direction.
- Search matches: `shellmates_scan`
  - List people and why they may fit. Do not send an intro until the user chooses a target.
- Send intro: `shellmates_intro`
  - Use only when the user provides the target and first message.
- Reply coaching: `shellmates_coach`
  - If the user asks for advice, suggest tone, intent, and question direction instead of writing a complete send-ready reply.
- Send message: `shellmates_send`
  - Use only when the user explicitly provides the exact text to send. Send that text as-is.
- Profile setup/publish: `shellmates_set_profile`, `shellmates_publish`
  - Set profile fields when provided. Publish only when the user clearly wants to publish.
- Safety/end: `shellmates_end`, `shellmates_block`, `shellmates_report`
  - Use only when the user explicitly asks to end, block, or report.

## Firewall Rules

- Do not pull Shellmates human message bodies or coaching into an ordinary coding session.
- Do not run body-revealing commands such as `shellmates open --include-bodies` in an ordinary coding session.
- Allowed in coding sessions: opening/focusing the Shellmates console, count-only status, and setup guidance.
- If the console cannot open automatically, tell the user to run `npx -y @taeyoung1005/shellmates open` in a separate terminal.

## Reply Rules

- When a channel notification arrives, show the received original text before interpretation or coaching.
- Call `shellmates_send` only when the user has provided the exact text to send.
- If the user only asks for advice, call `shellmates_coach`, suggest direction, and do not send.
