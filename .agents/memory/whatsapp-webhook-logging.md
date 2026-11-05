---
name: WhatsApp verification logs
description: Preventing Meta webhook verification credentials from entering development logs.
---

Meta webhook verification sends `hub.verify_token` in the GET query string. The SvelteKit development server logs request URLs by default, so redact `hub.verify_token` and `hub.challenge` in Vite's logger before handling verification requests. If an unredacted request has already been logged, rotate `WHATSAPP_VERIFY_TOKEN` before external use.

**Why:** The verification token is a credential even though Meta transmits it as a query parameter.

**How to apply:** Preserve the Vite logger redaction when changing dev-server configuration, and check workflow logs after webhook tests.
