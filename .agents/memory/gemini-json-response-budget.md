---
name: Gemini structured response budgets
description: Thinking-model alias changes can truncate structured JSON despite historical budget settings.
---

Output-token limits include thinking. A model alias can move to a version whose thinking controls differ; do not assume a historical zero thinking budget actually disables reasoning. Allow enough shared budget and inspect the completion reason before parsing JSON.

**Why:** on 2026-11-10 the Flash alias resolved to Gemini 3.8 Flash and consumed thinking tokens despite `thinkingBudget: 0`. Responses could end at `MAX_TOKENS` with nonempty but incomplete JSON. Earlier generic parse errors hid the truncation.

**How to apply:** check the model's current supported thinking controls when an alias changes. Treat incomplete generation as a technical failure, never as a semantic lack of classification or as repairable JSON. Keep safe completion metadata, not raw model output.
