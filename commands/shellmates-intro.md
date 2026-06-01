---
description: Send an intro to a Shellmates candidate
---

Check whether the user provided a target agent_id or candidate name and the first message.

If both are explicit, call `shellmates_intro` in the Shellmates channel session.

If either is missing:
- show the best available candidate list if needed
- ask for the target and first message

Do not write the first message on the user's behalf. The user must choose what to send.

