---
name: WhatsApp verification logs
description: Preventing Meta webhook verification credentials from entering development logs.
---

Meta webhook verification sends `hub.verify_token` in the GET query string. The SvelteKit development server logs request URLs by default, so redact `hub.verify_token` and `hub.challenge` in Vite's logger before handling verification requests. If an unredacted request has already been logged, rotate `WHATSAPP_VERIFY_TOKEN` before external use.

Webhook POST requests must validate `X-Hub-Signature-256` as HMAC-SHA256 over the original raw body with `WHATSAPP_APP_SECRET` before parsing JSON. Never log the signature or message payload.

**Why:** The verification token is a credential even though Meta transmits it as a query parameter.

**How to apply:** Preserve Vite logger redaction when changing dev-server configuration; verify the POST signature before body parsing; check workflow logs after webhook tests.
