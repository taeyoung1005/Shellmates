---
description: Open the current Shellmates chat and show reply direction
---

In the Shellmates channel session, call `shellmates_open`.

Output order:
1. Show the latest received original text first.
2. Briefly summarize the current chat flow.
3. Suggest reply strategy as tone, intent, and question direction, not as a complete send-ready message.

Do not call `shellmates_send` unless the user provides the exact text to send.

