import pg from "pg";
import {neonPoolOptions} from "./postgres-config.ts";
import type { CollaboratorStatus } from "./whatsapp-message-processing.js";
import type { Identity } from "./payroll-tickets.ts";

const COLLABORATOR_LOOKUP_SQL = `
  SELECT activo
  FROM public.colaboradores
  WHERE regexp_replace(COALESCE(whatsapp, ''), '[^0-9]', '', 'g') = $1
  LIMIT 2
`;

const ACTIVE_SERVICES_SQL = `
  SELECT id_servicio::text AS id_servicio, categoria, subcategoria
  FROM public.servicios
  WHERE activo IS TRUE
  ORDER BY categoria NULLS LAST, subcategoria NULLS LAST, id_servicio
`;

export type ActiveService = {
  idServicio: string;
  categoria: string | null;
  subcategoria: string | null;
};

let pool: pg.Pool | undefined;

export function getNeonPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  pool ??= new pg.Pool(neonPoolOptions(connectionString));

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

  const result = await getNeonPool().query<{ activo: boolean | null }>(
    COLLABORATOR_LOOKUP_SQL,
    [normalizedPhone]
  );

  if (result.rows.length > 1) return "ambiguous";
  if (result.rows.length === 0) return "not_found";
  return result.rows[0].activo === true ? "active" : "inactive";
}

export async function listActiveServices(): Promise<ActiveService[]> {
  const result = await getNeonPool().query<{
    id_servicio: string;
    categoria: string | null;
    subcategoria: string | null;
  }>(ACTIVE_SERVICES_SQL);

  return result.rows.map((row) => ({
    idServicio: row.id_servicio,
    categoria: row.categoria,
    subcategoria: row.subcategoria
  }));
}

/** Only the active, unambiguous directory match may become a ticket owner. */
export async function lookupCollaboratorIdentity(senderPhone: string): Promise<Identity> {
  const phone = senderPhone.replace(/\D/g, "");
  if (!phone) return { status: "not_found", id: null };
  const result = await getNeonPool().query<{ id_colaborador: string; activo: boolean | null }>(
    `SELECT id_colaborador, activo FROM public.colaboradores
     WHERE regexp_replace(COALESCE(whatsapp, ''), '[^0-9]', '', 'g') = $1 LIMIT 2`,
    [phone]
  );
  if (result.rows.length > 1) return { status: "ambiguous", id: null };
  if (!result.rows[0]) return { status: "not_found", id: null };
  return result.rows[0].activo === true
    ? { status: "active", id: result.rows[0].id_colaborador }
    : { status: "inactive", id: null };
}

export async function closeNeonPool(): Promise<void> {
  if (!pool) return;
  const currentPool = pool;
  pool = undefined;
  await currentPool.end();
}
