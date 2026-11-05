import pg from "pg";
import type { CollaboratorStatus } from "./whatsapp-message-processing.js";

const COLLABORATOR_LOOKUP_SQL = `
  SELECT activo
  FROM public.colaboradores
  WHERE regexp_replace(COALESCE(whatsapp, ''), '[^0-9]', '', 'g') = $1
  LIMIT 2
`;

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  pool ??= new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    max: 4,
    allowExitOnIdle: true
  });

  return pool;
}

/**
 * Read only the active flag for a normalized sender number.
 * Duplicate phone matches are reported as ambiguous rather than selecting one.
 */
export async function lookupCollaboratorStatus(
  senderPhone: string
): Promise<CollaboratorStatus> {
  const normalizedPhone = senderPhone.replace(/\D/g, "");
  if (!normalizedPhone) return "not_found";

  const result = await getPool().query<{ activo: boolean | null }>(
    COLLABORATOR_LOOKUP_SQL,
    [normalizedPhone]
  );

  if (result.rows.length > 1) return "ambiguous";
  if (result.rows.length === 0) return "not_found";
  return result.rows[0].activo === true ? "active" : "inactive";
}

export async function closeNeonPool(): Promise<void> {
  if (!pool) return;
  const currentPool = pool;
  pool = undefined;
  await currentPool.end();
}
