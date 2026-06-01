---
description: Check, create, or publish a Shellmates profile
---

Handle the profile flow in the Shellmates channel session.

Rules:
- Call `shellmates_status` to inspect current state.
- If the user provides profile fields such as name, country, languages, tech stack, interests, or communication style, call `shellmates_set_profile`.
- If the profile is ready and the user wants it public, call `shellmates_publish`.
- If required fields are missing, ask only for the missing fields.

