---
name: Neon pooled connections
description: Avoid session-lock and TLS-observation assumptions with Neon's transaction pooler.
---

Use transaction-scoped advisory locks inside a pinned transaction, not session
advisory locks across independent statements on the pooled endpoint.

**Why:** a logical client can use different PostgreSQL backends between
transactions. A session lock can remain on another backend, fail to exclude two
logical clients, or survive an attempted unlock on the wrong backend.

**How to apply:** never replace the bounded export transaction with a session
lock as an optimization. Moving external I/O outside that transaction requires
another authorized durable coordination design. Never hold Gemini calls inside
business transactions. For cleanup, identify only the test-owned lock; do not
terminate backends or unlock unrelated sessions.

Treat the application TLS socket and PostgreSQL backend TLS view separately.

**Why:** the client socket was encrypted and certificate-authorized while
`pg_stat_ssl` reported false, consistent with TLS termination before the compute
connection. Backend telemetry alone produced a false client-TLS failure.

**How to apply:** verify the actual client's TLS authorization without logging
connection strings or certificates. Do not disable certificate checks, and do
not infer encryption of every provider-internal segment from the client socket.
