import type pg from "pg";

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
}

export class TicketError extends Error {
  code: string;
  constructor(code: string) {
    super("Ticket operation unavailable");
    this.name = "TicketError";
    this.code = code;
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
    let client: pg.PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      if (error instanceof TicketError) throw error;
      // Do not expose pg errors: they may contain parameters and personal data.
      throw new TicketError("DATABASE_UNAVAILABLE");
    } finally {
      client?.release();
    }
  }

  async function find(client: pg.PoolClient, key: string, collaboratorId: string) {
    const result = await client.query<Omit<Ticket, "folio">>(
      `SELECT ${PROJECTION} FROM public.tickets WHERE id_mensaje_confirmacion = $1`, [key]
    );
    const row = result.rows[0];
    if (row && row.collaboratorId !== collaboratorId) throw new TicketError("IDENTITY_CONFLICT");
    return row ? mapTicket(row) : null;
  }

  return {
    mode: "neon",
    findByConfirmation(key, collaboratorId) {
      return transaction((client) => find(client, key, collaboratorId));
    },
    createConfirmed(input) {
      return transaction(async (client) => {
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
        const updated = await client.query<Omit<Ticket, "folio">>(
          `UPDATE public.tickets SET estado = 'cerrado sin cita',
             cerrado_en = NOW(), resultado = $3
           WHERE id_ticket = $1 AND id_colaborador = $2 AND estado = 'pendiente de cita'
             AND resuelto_en IS NULL
             AND EXISTS (SELECT 1 FROM public.colaboradores WHERE id_colaborador = $2 AND activo IS TRUE)
             AND NOT EXISTS (SELECT 1 FROM public.citas WHERE id_ticket = $1)
           RETURNING ${PROJECTION}`, [id, collaboratorId, CLOSED_OUTCOME]
        );
        if (updated.rows[0]) return mapTicket(updated.rows[0]);
        const current = await client.query<Omit<Ticket, "folio">>(
          `SELECT ${PROJECTION} FROM public.tickets WHERE id_ticket = $1 AND id_colaborador = $2`,
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
