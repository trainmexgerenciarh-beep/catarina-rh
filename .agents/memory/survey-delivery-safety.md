---
name: Survey delivery uncertainty
description: Preserve the distinction between a durable claim, fictitious acknowledgment, and actual external delivery.
---

An expired lease or unknown acknowledgment must not trigger a blind resend.
Keep uncertain work for review; accept a late authoritative acknowledgment only
for the same still-current attempt.

**Why:** PostgreSQL and Meta do not share a transaction. A worker can die after
the external effect but before recording it; lease expiry cannot prove no send.

**How to apply:** preserve this rule when enabling a future live transport.
Never reinterpret a FAKE_ONLY receipt as real delivery, set a real sent timestamp
for a mock acknowledgment, or assume credentials alone authorize activation.
Trainmex authorized only fictitious delivery in this closing iteration.
