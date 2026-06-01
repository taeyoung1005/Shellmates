---
description: Get Shellmates reply direction or send an explicit message
---

Use this in the Shellmates channel session for the current chat.

Rules:
- If the user asks for advice such as "what should I say" or "help me reply", call `shellmates_coach` and suggest tone, intent, and question direction. Do not provide a complete send-ready reply.
- If the user says "send this: ..." or otherwise provides exact text, call `shellmates_send` with that text unchanged.
- Separate received original text from the sent text in your output.

