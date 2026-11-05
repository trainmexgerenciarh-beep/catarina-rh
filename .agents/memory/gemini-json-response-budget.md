---
name: Gemini JSON response budget
description: SDK behavior for small structured classification responses with Gemini Flash.
---

For constrained classifications that need only a small JSON value, configure a zero thinking budget and leave sufficient output tokens for the response. Otherwise the model's default thinking can consume a small `maxOutputTokens` budget and return no usable JSON.

**Why:** a closed-catalog service classification hit `MAX_TOKENS` with the default thinking behavior; setting `thinkingBudget` to zero and increasing the output allowance made all real classification checks pass.

**How to apply:** use this for deterministic, low-complexity JSON routing tasks; do not disable thinking by default for tasks that need deeper reasoning.
