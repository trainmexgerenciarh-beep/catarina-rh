import type pg from "pg";
import {
  inAgendaTransaction, PersistenceError, requireEventId, type ConnectionPool
} from "./persistence-unit.ts";
import {
  commandFingerprint, checkedResult, canonicalInstant, requireId,
  type AgendaCommand, type Receipt, type PersistentAgenda, type StoredAppointment,
  type AppliedResult, type Modality
} from "./agenda-persistence-contract.ts";
import {
  SLOT_MS, NOTICE_MS, localDate, dateNumber, minutes, mexicoInstant, clock
} from "./agenda-time.ts";

type Hours = { day: number; begin: string; end: string; duration: number };
type Block = { date: string; begin: string; end: string };
const APPOINTMENT_COLUMNS = `id_cita::text AS id, id_ticket::text AS "ticketId",
 inicio_programado AS start, fin_programado AS end, modalidad AS modality, estado AS status`;
const RECEIPT_COLUMNS = `id_evento_meta AS "eventId", tipo_operacion AS operation,
 id_ticket::text AS "ticketId", id_cita::text AS "appointmentId",
 huella_parametros AS fingerprint, resultado AS result`;

function appointment(row: StoredAppointment): StoredAppointment {
  return { ...row, start: new Date(row.start).toISOString(), end: new Date(row.end).toISOString() };
}
function fail(code: string): never { throw new PersistenceError(code); }

/** Prepared SQL adapter. No pool creation, environment lookup, outbound transport,
 * or webhook registration. Explicit SIMULATION_ONLY gate even when given a pool.
 */
export function createNeonAgendaRepository(
  pool: ConnectionPool, options: { mode: "SIMULATION_ONLY" }
): PersistentAgenda {
  if (options.mode !== "SIMULATION_ONLY") fail("SIMULATION_ONLY_REQUIRED");
  const transaction = <T>(work: (c: pg.PoolClient) => Promise<T>) => inAgendaTransaction(pool, work);
  async function receipt(c: pg.PoolClient, eventId: string): Promise<Receipt | null> {
    return (await c.query<Receipt>(
      `SELECT /*c2:receipt*/ ${RECEIPT_COLUMNS} FROM public.operaciones_citas WHERE id_evento_meta=$1`,
      [eventId]
    )).rows[0] ?? null;
  }
  async function authorize(c: pg.PoolClient, ticketId: string, owner: string, mutable: boolean) {
    requireId(ticketId);
    const row = (await c.query<{ status: string; closed: unknown; resolved: unknown }>(
      `SELECT /*c2:authorize*/ t.estado AS status, t.cerrado_en AS closed, t.resuelto_en AS resolved
       FROM public.tickets t
       JOIN public.colaboradores c ON c.id_colaborador=t.id_colaborador
       JOIN public.servicios s ON s.id_servicio=t.id_servicio
       WHERE t.id_ticket=$1 AND t.id_colaborador=$2 AND c.activo IS TRUE
         AND s.activo IS TRUE AND s.categoria IN ('Nómina y prestaciones','Políticas y procedimientos')
       FOR UPDATE OF t FOR SHARE OF c,s`, [ticketId, owner]
    )).rows[0];
    if (!row) fail("ACCESS_DENIED");
    if (mutable && (row.closed || row.resolved || row.status !== "pendiente de cita")) fail("TICKET_UNAVAILABLE");
  }
  async function own(c: pg.PoolClient, id: string, ticketId: string): Promise<StoredAppointment> {
    requireId(id);
    const row = (await c.query<StoredAppointment>(
      `SELECT /*c2:own*/ ${APPOINTMENT_COLUMNS} FROM public.citas
       WHERE id_cita=$1 AND id_ticket=$2 FOR UPDATE`, [id, ticketId]
    )).rows[0];
    if (!row) fail("APPOINTMENT_NOT_FOUND");
    return appointment(row);
  }
  async function clockNow(c: pg.PoolClient): Promise<number> {
    // Numeric epoch keeps fractional milliseconds instead of truncating a Date.
    const row = (await c.query<{ now: string }>(
      "SELECT /*c2:clock*/ extract(epoch FROM clock_timestamp())*1000 AS now"
    )).rows[0];
    const value = Number(row?.now);
    if (!Number.isFinite(value)) fail("INVALID_DATABASE_CLOCK");
    return value;
  }
  async function calendar(c: pg.PoolClient) {
    const hours = (await c.query<Hours>(
      `SELECT /*c2:hours*/ dia_semana AS day,
       CASE WHEN extract(second FROM hora_inicio)=0 THEN to_char(hora_inicio,'HH24:MI') END AS begin,
       CASE WHEN extract(second FROM hora_fin)=0 THEN to_char(hora_fin,'HH24:MI') END AS end,
       duracion_cita AS duration
       FROM public.horarios_atencion WHERE activo IS TRUE ORDER BY dia_semana,hora_inicio`
    )).rows;
    const blocks = (await c.query<Block>(
      `SELECT /*c2:blocks*/ fecha::text AS date,
       CASE WHEN extract(second FROM hora_inicio)=0 THEN to_char(hora_inicio,'HH24:MI') END AS begin,
       CASE WHEN extract(second FROM hora_fin)=0 THEN to_char(hora_fin,'HH24:MI') END AS end
       FROM public.bloqueos_agenda ORDER BY fecha,hora_inicio`
    )).rows;
    const rows = (await c.query<StoredAppointment>(
      `SELECT /*c2:occupied*/ ${APPOINTMENT_COLUMNS} FROM public.citas WHERE estado='PROGRAMADA'`
    )).rows.map(appointment);
    try {
      if (!hours.length) fail("NO_CONFIGURED_HOURS");
      for (const h of hours) {
        if (!Number.isInteger(h.day) || h.day < 1 || h.day > 5 || h.duration !== 20 ||
          minutes(h.begin) >= minutes(h.end)) fail("INVALID_CALENDAR");
      }
      for (let i = 0; i < hours.length; i++) for (let j = i + 1; j < hours.length; j++) {
        const a = hours[i], b = hours[j];
        if (a.day === b.day && minutes(a.begin) < minutes(b.end) &&
          minutes(b.begin) < minutes(a.end)) fail("INVALID_CALENDAR");
      }
      for (const b of blocks) {
        dateNumber(b.date);
        if (minutes(b.begin) >= minutes(b.end)) fail("INVALID_CALENDAR");
      }
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      fail("INVALID_CALENDAR");
    }
    return { hours, blocks, rows };
  }
  function available(start: number, now: number, data: Awaited<ReturnType<typeof calendar>>, exclude?: string) {
    if (!Number.isFinite(start) || start - now < NOTICE_MS) return false;
    const date = localDate(start);
    const day = new Date(dateNumber(date)).getUTCDay() || 7;
    const end = start + SLOT_MS;
    const intersects = (a: number, b: number) => start < b && a < end;
    return data.hours.some(h => {
      const begin = mexicoInstant(date, h.begin), finish = mexicoInstant(date, h.end);
      return h.day === day && start >= begin && end <= finish && (start - begin) % SLOT_MS === 0;
    }) && !data.blocks.some(b => b.date === date &&
      intersects(mexicoInstant(date, b.begin), mexicoInstant(date, b.end))) &&
      !data.rows.some(r => r.id !== exclude && intersects(Date.parse(r.start), Date.parse(r.end)));
  }

  return {
    mode: "SIMULATION_ONLY",
    forOwner(collaboratorId) {
      return transaction(async c => {
        const rows = (await c.query<StoredAppointment>(
          `SELECT /*c4:owner*/ a.id_cita::text AS id,a.id_ticket::text AS "ticketId",
            a.inicio_programado AS start,a.fin_programado AS end,a.modalidad AS modality,a.estado AS status
           FROM public.citas a JOIN public.tickets t ON t.id_ticket=a.id_ticket
           JOIN public.colaboradores c ON c.id_colaborador=t.id_colaborador
           JOIN public.servicios s ON s.id_servicio=t.id_servicio
           WHERE t.id_colaborador=$1 AND c.activo IS TRUE AND s.activo IS TRUE
             AND s.categoria IN ('Nómina y prestaciones','Políticas y procedimientos') AND a.estado='PROGRAMADA'
           ORDER BY a.inicio_programado,a.id_cita FOR SHARE OF a,t,c,s`, [collaboratorId]
        )).rows;
        return rows.map(appointment);
      });
    },
    findApplied(eventId, collaboratorId) {
      requireEventId(eventId);
      return transaction(async c => {
        const prior = await receipt(c, eventId); // Does not depend on conversation memory.
        if (!prior) return null;
        await authorize(c, prior.ticketId, collaboratorId, false);
        await own(c, prior.appointmentId, prior.ticketId);
        return checkedResult(prior);
      });
    },
    findAppointment(id, ticketId, collaboratorId) {
      return transaction(async c => {
        await authorize(c, ticketId, collaboratorId, false);
        return own(c, id, ticketId);
      });
    },
    listAvailable(input) {
      return transaction(async c => {
        if (!["PRESENCIAL", "REMOTA"].includes(input.modality)) fail("INVALID_COMMAND");
        try { dateNumber(input.date); } catch { fail("INVALID_DATE"); }
        await authorize(c, input.ticketId, input.collaboratorId, true);
        const data = await calendar(c);
        const now = await clockNow(c);
        const day = new Date(dateNumber(input.date)).getUTCDay() || 7;
        const slots: string[] = [];
        for (const h of data.hours.filter(h => h.day === day)) {
          for (let m = minutes(h.begin); m + 20 <= minutes(h.end); m += 20) {
            const start = mexicoInstant(input.date, clock(m));
            if (available(start, now, data)) slots.push(new Date(start).toISOString());
          }
        }
        return slots;
      });
    },
    execute(input: AgendaCommand) {
      const fingerprint = commandFingerprint(input);
      return transaction(async c => {
        const prior = await receipt(c, input.eventId);
        if (prior) {
          await authorize(c, prior.ticketId, input.collaboratorId, false);
          if (prior.fingerprint !== fingerprint) fail("EVENT_CONFLICT");
          await own(c, prior.appointmentId, prior.ticketId);
          return checkedResult(prior); // Original snapshot, NOT the current appointment.
        }
        const ticketEvent = await c.query(
          `SELECT /*c2:ticket-event*/ id_ticket FROM public.tickets WHERE id_mensaje_confirmacion=$1`,
          [input.eventId]
        );
        if (ticketEvent.rows.length) fail("EVENT_CONFLICT");
        await authorize(c, input.ticketId, input.collaboratorId, true);
        const source = input.operation === "RESERVAR" ? null :
          await own(c, input.appointmentId!, input.ticketId);
        if (source && (source.status !== "PROGRAMADA" || source.modality !== input.modality)) {
          fail("INVALID_TRANSITION");
        }
        const data = await calendar(c);
        const now = await clockNow(c); // AFTER agenda/ticket/identity locks and configuration reads.
        if (source && Date.parse(source.start) - now < NOTICE_MS) fail("NOTICE_TOO_SHORT");
        if (input.operation === "RESERVAR" && data.rows.some(r => r.ticketId === input.ticketId)) {
          fail("ALREADY_BOOKED");
        }
        const destination = input.operation === "CANCELAR" ? source!.start : canonicalInstant(input.start!);
        if (input.operation !== "CANCELAR" && (!available(Date.parse(destination), now, data, source?.id) ||
          (source && source.start === destination))) fail("SLOT_UNAVAILABLE");
        let row: StoredAppointment | undefined;
        if (input.operation === "RESERVAR") {
          row = (await c.query<StoredAppointment>(
            `INSERT /*c2:book*/ INTO public.citas
             (id_ticket,inicio_programado,fin_programado,modalidad,estado)
             SELECT $1,$2::timestamptz,$2::timestamptz+interval '20 minutes',$3,'PROGRAMADA'
             WHERE $2::timestamptz >= clock_timestamp()+interval '120 minutes'
             RETURNING ${APPOINTMENT_COLUMNS}`, [input.ticketId, destination, input.modality]
          )).rows[0];
        } else {
          // One UPDATE, never cancel+commit+insert. Final DB-clock guard includes network delay.
          row = (await c.query<StoredAppointment>(
            `UPDATE /*c2:change*/ public.citas SET
               inicio_programado=$3::timestamptz,fin_programado=$3::timestamptz+interval '20 minutes',
               estado=$4
             WHERE id_cita=$1 AND id_ticket=$2 AND estado='PROGRAMADA'
               AND inicio_programado >= clock_timestamp()+interval '120 minutes'
               AND ($4='CANCELADA' OR $3::timestamptz >= clock_timestamp()+interval '120 minutes')
             RETURNING ${APPOINTMENT_COLUMNS}`,
            [source!.id, input.ticketId, destination, input.operation === "CANCELAR" ? "CANCELADA" : "PROGRAMADA"]
          )).rows[0];
        }
        if (!row) fail("NOTICE_TOO_SHORT");
        const stored = appointment(row);
        const result: AppliedResult = {
          version: 1, operation: input.operation, ticketId: stored.ticketId, appointmentId: stored.id,
          modality: stored.modality, status: input.operation === "CANCELAR" ? "CANCELADA" : "PROGRAMADA",
          start: stored.start, end: stored.end
        };
        await c.query(
          `INSERT /*c2:save-receipt*/ INTO public.operaciones_citas
           (id_evento_meta,tipo_operacion,id_ticket,id_cita,huella_parametros,resultado)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [input.eventId, input.operation, input.ticketId, stored.id, fingerprint, JSON.stringify(result)]
        );
        return result;
      });
    }
  };
}
