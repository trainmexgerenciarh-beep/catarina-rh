import type pg from "pg";

/** One resource for ALL modalities, ticket confirmations and ticket closure.
 * Every future schedule/block writer must participate in this same protocol.
 */
export const AGENDA_LOCK_KEY = "2026111001";
export type ConnectionPool = Pick<pg.Pool, "connect">;

export class PersistenceError extends Error {
  code: string;
  constructor(code: string) {
    super("Persistence operation unavailable");
    this.name = "PersistenceError";
    this.code = code;
  }
}

/** No AI/network callbacks belong inside work. A result is returned only after
 * COMMIT acknowledgement. Unknown COMMIT outcomes must be recovered by event ID,
 * never by blind automatic retry. No secrets, SQL or parameters escape errors.
 */
export async function inAgendaTransaction<T>(
  pool: ConnectionPool, work: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  let client: pg.PoolClient | undefined;
  let committing = false;
  let destroy = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [AGENDA_LOCK_KEY]);
    const result = await work(client);
    committing = true;
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (committing) {
      destroy = true;
      throw new PersistenceError("COMMIT_OUTCOME_UNKNOWN");
    }
    if (client) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
    }
    if (error instanceof PersistenceError) throw error;
    const code = (error as { code?: string })?.code;
    if (code === "23505" || code === "23P01") throw new PersistenceError("PERSISTENCE_CONFLICT");
    if (code === "55P03" || code === "57014") throw new PersistenceError("PERSISTENCE_BUSY");
    throw new PersistenceError("DATABASE_UNAVAILABLE");
  } finally {
    client?.release(destroy);
  }
}

/** No whitespace stripping: keep the original opaque Meta identifier intact.
 * Origin is guaranteed by the authenticated caller, not by a guessed prefix.
 */
export function requireEventId(value: string): void {
  if (typeof value !== "string" || !value.length || value.trim() !== value ||
    /\s/.test(value)) throw new PersistenceError("MISSING_EVENT_ID");
}
