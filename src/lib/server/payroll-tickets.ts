import type pg from "pg";
import { inAgendaTransaction, PersistenceError, requireEventId } from "./persistence-unit.ts";

export type Identity = {
  status: "active" | "inactive" | "not_found" | "ambiguous";
  id: string | null;
};

export type Ticket = {
  id: string;
  folio: string;
  collaboratorId: string;
  serviceId: string;
  description: string;
  summary: string;
  status: string;
  closedAt: string | null;
  resolvedAt: string | null;
  outcome: string | null;
  confirmationId: string;
};

export type ConfirmedTicket = {
  collaboratorId: string;
  serviceId: string;
  description: string;
  summary: string;
  confirmationId: string;
};

export interface TicketRepository {
  mode: "simulation" | "neon";
  findByConfirmation(key: string, collaboratorId: string): Promise<Ticket | null>;
  createConfirmed(input: ConfirmedTicket): Promise<Ticket>;
  closeWithoutAppointment(id: string, collaboratorId: string): Promise<Ticket>;
  pendingForOwner?(collaboratorId: string): Promise<Ticket[]>;
}

export class TicketError extends PersistenceError {
  constructor(code: string) {
    super(code);
    this.name = "TicketError";
  }
}

export const CLOSED_OUTCOME =
  "No resuelto. El colaborador rechazó expresamente agendar una cita.";

/** Simulation only. Sharing this repository is not sharing conversation context. */
export function createMemoryTicketRepository(seed: Ticket[] = []) {
  const rows = new Map(seed.map((row) => [row.id, structuredClone(row)]));
  let nextId = seed.reduce((max, row) => BigInt(row.id) > max ? BigInt(row.id) : max, 0n);
  const repository: TicketRepository & { snapshot(): Ticket[] } = {
    mode: "simulation",
    async findByConfirmation(key, collaboratorId) {
      const row = [...rows.values()].find((ticket) => ticket.confirmationId === key);
      if (row && row.collaboratorId !== collaboratorId) throw new TicketError("IDENTITY_CONFLICT");
      return row ? structuredClone(row) : null;
    },
    async createConfirmed(input) {
      const existing = [...rows.values()].find(
        (row) => row.confirmationId === input.confirmationId
      );
      if (existing) {
        if (existing.collaboratorId !== input.collaboratorId) throw new TicketError("IDENTITY_CONFLICT");
        return structuredClone(existing);
      }
      // No await between lookup and insertion: atomic in this simulation process.
      const id = String(++nextId);
      const row: Ticket = {
        ...input, id, folio: `SIM-NOM-${id}`, status: "pendiente de cita",
        closedAt: null, resolvedAt: null, outcome: null
      };
      rows.set(id, row);
      return structuredClone(row);
    },
    async closeWithoutAppointment(id, collaboratorId) {
      const row = rows.get(id);
      if (!row || row.collaboratorId !== collaboratorId) throw new TicketError("TICKET_NOT_FOUND");
      if (row.status === "cerrado sin cita") return structuredClone(row);
      if (row.status !== "pendiente de cita" || row.resolvedAt) throw new TicketError("INVALID_TRANSITION");
      row.status = "cerrado sin cita";
      row.closedAt = new Date().toISOString();
      row.outcome = CLOSED_OUTCOME;
      return structuredClone(row);
    },
    snapshot() {
      return [...rows.values()].map((row) => structuredClone(row));
    }
  };
  return repository;
}

const PROJECTION = `
 id_ticket::text AS id, id_colaborador AS "collaboratorId",
 id_servicio::text AS "serviceId", descripcion AS description, resumen AS summary,
 estado AS status, cerrado_en::text AS "closedAt", resuelto_en::text AS "resolvedAt",
 resultado AS outcome, id_mensaje_confirmacion AS "confirmationId"
`;

function mapTicket(row: Omit<Ticket, "folio">): Ticket {
  return { ...row, folio: `NOM-${row.id}` };
}

/**
 * Prepared adapter, NOT selected by the simulation webhook.
 * PostgreSQL UNIQUE arbitrates concurrent confirmations across processes.
 * Never interpolates a phone, message, ID or summary into SQL.
 */
export function createNeonTicketRepository(pool: Pick<pg.Pool, "connect">): TicketRepository {
  async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    try {
      return await inAgendaTransaction(pool, work);
    } catch (error) {
      if (error instanceof TicketError) throw error;
      throw new TicketError(error instanceof PersistenceError ? error.code : "DATABASE_UNAVAILABLE");
    }
  }

  async function find(client: pg.PoolClient, key: string, collaboratorId: string) {
    const result = await client.query<Omit<Ticket, "folio">>(
      `SELECT ${PROJECTION} FROM public.tickets WHERE id_mensaje_confirmacion = $1`, [key]
    );
    const row = result.rows[0];
    if (row && row.collaboratorId !== collaboratorId) throw new TicketError("IDENTITY_CONFLICT");
    if (row) {
      const access = await client.query(
        `SELECT c.id_colaborador FROM public.colaboradores c
         JOIN public.servicios s ON s.id_servicio=$2
         WHERE c.id_colaborador=$1 AND c.activo IS TRUE AND s.activo IS TRUE
           AND s.categoria='Nómina y prestaciones' FOR SHARE OF c,s`,
        [collaboratorId, row.serviceId]
      );
      if (access.rows.length !== 1) throw new TicketError("INACTIVE_IDENTITY_OR_SERVICE");
    }
    return row ? mapTicket(row) : null;
  }

  return {
    mode: "neon",
    pendingForOwner(collaboratorId) {
      return transaction(async c => {
        const rows = (await c.query<Omit<Ticket,"folio">>(
          `SELECT /*c4:pending*/ ${PROJECTION} FROM public.tickets
           WHERE id_colaborador=$1 AND estado='pendiente de cita'
             AND cerrado_en IS NULL AND resuelto_en IS NULL
             AND EXISTS (SELECT 1 FROM public.colaboradores c
               WHERE c.id_colaborador=$1 AND c.activo IS TRUE)
             AND EXISTS (SELECT 1 FROM public.servicios s
               WHERE s.id_servicio=tickets.id_servicio AND s.activo IS TRUE
                 AND s.categoria='Nómina y prestaciones')
             AND NOT EXISTS (SELECT 1 FROM public.citas a
               WHERE a.id_ticket=tickets.id_ticket AND a.estado='PROGRAMADA')
           ORDER BY id_ticket FOR SHARE`,[collaboratorId]
        )).rows;
        return rows.map(mapTicket);
      });
    },
    findByConfirmation(key, collaboratorId) {
      return transaction((client) => find(client, key, collaboratorId));
    },
    createConfirmed(input) {
      return transaction(async (client) => {
        requireEventId(input.confirmationId);
        const agendaReceipt = await client.query(
          "SELECT id_evento_meta FROM public.operaciones_citas WHERE id_evento_meta = $1",
          [input.confirmationId]
        );
        if (agendaReceipt.rows.length) throw new TicketError("EVENT_CONFLICT");
        const identity = await client.query(
          "SELECT id_colaborador FROM public.colaboradores WHERE id_colaborador = $1 AND activo IS TRUE FOR SHARE",
          [input.collaboratorId]
        );
        const service = await client.query(
          "SELECT id_servicio FROM public.servicios WHERE id_servicio = $1 AND activo IS TRUE AND categoria = $2 FOR SHARE",
          [input.serviceId, "Nómina y prestaciones"]
        );
        if (identity.rows.length !== 1 || service.rows.length !== 1) {
          throw new TicketError("INACTIVE_IDENTITY_OR_SERVICE");
        }
        const inserted = await client.query<Omit<Ticket, "folio">>(
          `INSERT INTO public.tickets
             (id_colaborador, id_servicio, descripcion, resumen, estado, id_mensaje_confirmacion)
           VALUES ($1, $2, $3, $4, 'pendiente de cita', $5)
           ON CONFLICT (id_mensaje_confirmacion) DO NOTHING
           RETURNING ${PROJECTION}`,
          [input.collaboratorId, input.serviceId, input.description, input.summary, input.confirmationId]
        );
        if (inserted.rows[0]) return mapTicket(inserted.rows[0]);
        const existing = await find(client, input.confirmationId, input.collaboratorId);
        if (!existing) throw new TicketError("CONFIRMATION_NOT_FOUND");
        return existing;
      });
    },
    closeWithoutAppointment(id, collaboratorId) {
      return transaction(async (client) => {
        const access = await client.query(
          `SELECT /*c2:close-access*/ t.id_ticket FROM public.tickets t
           JOIN public.colaboradores c ON c.id_colaborador=t.id_colaborador
           JOIN public.servicios s ON s.id_servicio=t.id_servicio
           WHERE t.id_ticket=$1 AND t.id_colaborador=$2 AND c.activo IS TRUE
             AND s.activo IS TRUE AND s.categoria='Nómina y prestaciones'
           FOR UPDATE OF t FOR SHARE OF c,s`, [id, collaboratorId]
        );
        if (access.rows.length !== 1) throw new TicketError("INACTIVE_IDENTITY_OR_SERVICE");
        const updated = await client.query<Omit<Ticket, "folio">>(
          `UPDATE public.tickets SET estado = 'cerrado sin cita',
             cerrado_en = NOW(), resultado = $3
           WHERE id_ticket = $1 AND id_colaborador = $2 AND estado = 'pendiente de cita'
             AND resuelto_en IS NULL
             AND EXISTS (SELECT 1 FROM public.colaboradores WHERE id_colaborador = $2 AND activo IS TRUE)
             AND EXISTS (SELECT 1 FROM public.servicios s
               WHERE s.id_servicio = tickets.id_servicio AND s.activo IS TRUE
                 AND s.categoria = 'Nómina y prestaciones')
             AND NOT EXISTS (SELECT 1 FROM public.citas WHERE id_ticket = $1 AND estado <> 'CANCELADA')
           RETURNING ${PROJECTION}`, [id, collaboratorId, CLOSED_OUTCOME]
        );
        if (updated.rows[0]) return mapTicket(updated.rows[0]);
        const current = await client.query<Omit<Ticket, "folio">>(
          `SELECT ${PROJECTION} FROM public.tickets
           WHERE id_ticket = $1 AND id_colaborador = $2
             AND EXISTS (SELECT 1 FROM public.colaboradores WHERE id_colaborador = $2 AND activo IS TRUE)
             AND EXISTS (SELECT 1 FROM public.servicios s
               WHERE s.id_servicio = tickets.id_servicio AND s.activo IS TRUE
                 AND s.categoria = 'Nómina y prestaciones')`,
          [id, collaboratorId]
        );
        if (current.rows[0]?.status === "cerrado sin cita" && !current.rows[0].resolvedAt) {
          return mapTicket(current.rows[0]);
        }
        throw new TicketError("INVALID_TRANSITION");
      });
    }
  };
}
