import type { Ticket } from "./payroll-tickets.ts";
import {
  SLOT_MS, NOTICE_MS, localDate, dateNumber, minutes, mexicoInstant, plusDays, clock
} from "./agenda-time.ts";

export type Window = {
  diaSemana: number; horaInicio: string; horaFin: string; duracionCita: number; activo: boolean;
};
export type Block = { fecha: string; horaInicio: string; horaFin: string };
export type Appointment = {
  id: string; ticketId: string; collaboratorId: string;
  start: number; end: number; modality: "presencial"; status: "confirmada" | "cancelada";
};
type Command = { ticketId: string; collaboratorId: string; key: string; now: number };

export class AgendaError extends Error {
  code: string;
  constructor(code: string) {
    super("Simulated agenda operation unavailable");
    this.code = code;
  }
}

export const INITIAL_WINDOWS: Window[] = [1, 2, 3, 4, 5].map((diaSemana) => ({
  diaSemana, horaInicio: "14:00", horaFin: "17:30", duracionCita: 20, activo: true
}));

/**
 * One instance = ONE institutional resource, shared by every simulated caller.
 * Synchronous validation + mutation has no await: atomic only in this JS process.
 * Never imports pg, secrets, transport or a Neon write repository.
 */
export function createSimulatedAgenda(options: {
  findTicket(id: string): Ticket | undefined;
  isActivePayrollService(id: string): boolean;
  windows?: Window[];
  blocks?: Block[];
}) {
  let windows: Window[] = [];
  let blocks: Block[] = [];
  const rows = new Map<string, Appointment>();
  const receipts = new Map<string, { signature: string; appointmentId: string }>();
  let nextId = 0;

  function setWindows(value: Window[]) {
    for (const row of value) {
      if (!Number.isInteger(row.diaSemana) || row.diaSemana < 1 || row.diaSemana > 5 ||
        row.duracionCita !== 20 || minutes(row.horaInicio) >= minutes(row.horaFin)) {
        throw new AgendaError("INVALID_WINDOWS");
      }
    }
    for (let i = 0; i < value.length; i++) {
      for (let j = i + 1; j < value.length; j++) {
        const a = value[i], b = value[j];
        if (a.activo && b.activo && a.diaSemana === b.diaSemana &&
          minutes(a.horaInicio) < minutes(b.horaFin) && minutes(b.horaInicio) < minutes(a.horaFin)) {
          throw new AgendaError("OVERLAPPING_WINDOWS");
        }
      }
    }
    windows = structuredClone(value);
  }
  function setBlocks(value: Block[]) {
    for (const block of value) {
      dateNumber(block.fecha);
      if (minutes(block.horaInicio) >= minutes(block.horaFin)) throw new AgendaError("INVALID_BLOCK");
    }
    blocks = structuredClone(value);
  }
  setWindows(options.windows ?? INITIAL_WINDOWS);
  setBlocks(options.blocks ?? []);

  function authorize(ticketId: string, owner: string, allowClosed = false) {
    const ticket = options.findTicket(ticketId);
    if (!ticket || ticket.collaboratorId !== owner) throw new AgendaError("TICKET_NOT_FOUND");
    if (!options.isActivePayrollService(ticket.serviceId)) throw new AgendaError("PAYROLL_SERVICE_UNAVAILABLE");
    if (!allowClosed && (ticket.closedAt || ticket.resolvedAt ||
      ticket.status !== "pendiente de cita")) throw new AgendaError("TICKET_UNAVAILABLE");
    return ticket;
  }
  function overlaps(a: number, b: number, c: number, d: number) {
    return a < d && c < b;
  }
  function available(start: number, now: number, excludeId?: string): boolean {
    if (!Number.isFinite(start) || !Number.isFinite(now) || start - now < NOTICE_MS) return false;
    const date = localDate(start);
    const day = new Date(dateNumber(date)).getUTCDay();
    if (day === 0 || day === 6) return false;
    const inWindow = windows.some((window) => {
      if (!window.activo || window.diaSemana !== day) return false;
      const begin = mexicoInstant(date, window.horaInicio);
      const end = mexicoInstant(date, window.horaFin);
      return start >= begin && start + SLOT_MS <= end && (start - begin) % SLOT_MS === 0;
    });
    if (!inWindow) return false;
    if (blocks.some((block) => block.fecha === date && overlaps(start, start + SLOT_MS,
      mexicoInstant(date, block.horaInicio), mexicoInstant(date, block.horaFin)))) return false;
    return ![...rows.values()].some((row) => row.id !== excludeId && row.status === "confirmada"
      && overlaps(start, start + SLOT_MS, row.start, row.end));
  }
  function list(input: { ticketId: string; collaboratorId: string; now: number; date?: string; days?: number; excludeId?: string }) {
    authorize(input.ticketId, input.collaboratorId);
    const first = input.date ?? localDate(input.now);
    dateNumber(first);
    const days = input.days ?? 14; // Simulation search horizon, not an approved production booking limit.
    if (!Number.isInteger(days) || days < 1 || days > 31) throw new AgendaError("INVALID_SEARCH");
    const starts = new Set<number>();
    for (let index = 0; index < days; index++) {
      const date = plusDays(first, index);
      const day = new Date(dateNumber(date)).getUTCDay();
      for (const window of windows.filter((row) => row.activo && row.diaSemana === day)) {
        for (let minute = minutes(window.horaInicio); minute + 20 <= minutes(window.horaFin); minute += 20) {
          const start = mexicoInstant(date, clock(minute));
          if (available(start, input.now, input.excludeId)) starts.add(start);
        }
      }
    }
    return [...starts].sort((a, b) => a - b);
  }
  function existing(input: Command, kind: string, start?: number, id?: string) {
    if (!/^[A-Za-z0-9_.:+/=-]{1,512}$/.test(input.key)) throw new AgendaError("MISSING_EVENT_KEY");
    const signature = JSON.stringify([input.collaboratorId, input.ticketId, kind, start, id]);
    const prior = receipts.get(input.key);
    if (prior && prior.signature !== signature) throw new AgendaError("EVENT_CONFLICT");
    return { signature, prior: prior ? structuredClone(rows.get(prior.appointmentId)!) : null };
  }
  function ownAppointment(id: string, input: Command) {
    const row = rows.get(id);
    if (!row || row.collaboratorId !== input.collaboratorId || row.ticketId !== input.ticketId) {
      throw new AgendaError("APPOINTMENT_NOT_FOUND");
    }
    return row;
  }
  function active(ticketId: string, owner: string) {
    authorize(ticketId, owner, true);
    return [...rows.values()].filter((row) => row.ticketId === ticketId && row.collaboratorId === owner
      && row.status === "confirmada").map((row) => structuredClone(row));
  }

  return {
    mode: "simulation" as const, setWindows, setBlocks, list,
    book(input: Command & { start: number }): Appointment {
      authorize(input.ticketId, input.collaboratorId);
      const receipt = existing(input, "book", input.start);
      if (receipt.prior) return receipt.prior;
      if (active(input.ticketId, input.collaboratorId).length) throw new AgendaError("ALREADY_BOOKED");
      if (!available(input.start, input.now)) throw new AgendaError("SLOT_UNAVAILABLE");
      const row: Appointment = {
        id: `SIM-CITA-${++nextId}`, ticketId: input.ticketId, collaboratorId: input.collaboratorId,
        start: input.start, end: input.start + SLOT_MS, modality: "presencial", status: "confirmada"
      };
      rows.set(row.id, row);
      receipts.set(input.key, { signature: receipt.signature, appointmentId: row.id });
      return structuredClone(row);
    },
    cancel(input: Command & { id: string }): Appointment {
      authorize(input.ticketId, input.collaboratorId);
      const receipt = existing(input, "cancel", undefined, input.id);
      if (receipt.prior) return receipt.prior;
      const row = ownAppointment(input.id, input);
      if (row.status !== "confirmada" || row.start - input.now < NOTICE_MS) {
        throw new AgendaError("CANCELLATION_UNAVAILABLE");
      }
      row.status = "cancelada";
      receipts.set(input.key, { signature: receipt.signature, appointmentId: row.id });
      return structuredClone(row);
    },
    reschedule(input: Command & { id: string; start: number }): Appointment {
      authorize(input.ticketId, input.collaboratorId);
      const receipt = existing(input, "reschedule", input.start, input.id);
      if (receipt.prior) return receipt.prior;
      const row = ownAppointment(input.id, input);
      if (row.status !== "confirmada" || row.start - input.now < NOTICE_MS ||
        row.start === input.start || !available(input.start, input.now, row.id)) {
        throw new AgendaError("RESCHEDULE_UNAVAILABLE");
      }
      // Validate EVERYTHING before either mutation; failed replacement retains original.
      row.start = input.start;
      row.end = input.start + SLOT_MS;
      receipts.set(input.key, { signature: receipt.signature, appointmentId: row.id });
      return structuredClone(row);
    },
    active,
    forOwner(owner: string) {
      return [...rows.values()].filter((row) => row.collaboratorId === owner && row.status === "confirmada"
        && options.findTicket(row.ticketId)?.collaboratorId === owner).map((row) => structuredClone(row));
    },
    snapshot() { return [...rows.values()].map((row) => structuredClone(row)); }
  };
}

export type SimulatedAgenda = ReturnType<typeof createSimulatedAgenda>;
