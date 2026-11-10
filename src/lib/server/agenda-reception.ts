import { createPayrollReception, INACTIVITY_MS } from "./payroll-reception.ts";
import { normalizePayrollInput } from "./payroll-dates.ts";
import type { createMemoryTicketRepository } from "./payroll-tickets.ts";
import { AgendaError, type Appointment, type SimulatedAgenda } from "./agenda-simulation.ts";
import { dateNumber, displayAppointment } from "./agenda-time.ts";

type Dependencies = Parameters<typeof createPayrollReception>[0];
type Tickets = ReturnType<typeof createMemoryTicketRepository>;
type PayrollResult = Awaited<ReturnType<ReturnType<typeof createPayrollReception>["handleMessage"]>>;
type Context = {
  owner: string; activity: number; ticketId?: string;
  phase: "idle" | "offer" | "select" | "confirm-book" | "confirm-cancel" | "confirm-move";
  choices: number[]; selected?: number; appointmentId?: string; moving?: boolean; offset: number;
};
const YES = /^(?:si|si,? confirmo|confirmo|confirmar|de acuerdo)$/;
const NO = /^(?:no|no confirmo)$/;
const NAV = /^(?:cancelar|cancela|salir|menu(?: principal)?|inicio|regresar|volver|atras|anterior)$/;

function reply(action: string, text: string): PayrollResult {
  return {
    collaboratorStatus: "active", action, classification: null,
    reply: `Simulación 02-B; sin reserva real ni escritura en Neon. ${text}`
  };
}

/**
 * Simulation entry point, deliberately NOT wired to the WhatsApp webhook.
 * Reuses 02-A unchanged; callers must share one agenda instance for one resource.
 */
export function createAgendaReception(
  dependencies: Dependencies, tickets: Tickets, agenda: SimulatedAgenda,
  options: { now?: () => number } = {}
) {
  if (tickets.mode !== "simulation" || agenda.mode !== "simulation") {
    throw new AgendaError("SIMULATION_ONLY");
  }
  const now = options.now ?? Date.now;
  const payroll = createPayrollReception(dependencies, tickets, { now });
  const contexts = new Map<string, Context>();
  // Technical IDs only, never a history of prepared replies or message text.
  const receipts = new Set<string>();
  const queues = new Map<string, Promise<void>>();

  function describe(row: Appointment) {
    const ticket = tickets.snapshot().find((ticket) => ticket.id === row.ticketId);
    return `${displayAppointment(row.start)}, presencial, ticket ${ticket?.folio}.`;
  }
  function offer(context: Context, date?: string): PayrollResult {
    if (date) {
      try { dateNumber(date); } catch { throw new AgendaError("INVALID_DATE"); }
    }
    const all = agenda.list({
      ticketId: context.ticketId!, collaboratorId: context.owner, now: now(), date,
      excludeId: context.moving ? context.appointmentId : undefined
    }).filter((start) => !context.moving ||
      start !== agenda.active(context.ticketId!, context.owner)[0]?.start);
    context.choices = all.slice(context.offset, context.offset + 6);
    context.phase = "select";
    delete context.selected;
    return reply("agenda_options", context.choices.length
      ? `Opciones presenciales:\n${context.choices.map((start, index) =>
        `${index + 1}. ${displayAppointment(start)}`).join("\n")}\nElige un número; después pediré confirmación. Puedes pedir «más opciones» u «opciones AAAA-MM-DD».`
      : "No hay bloques disponibles en esta búsqueda. No registré cambios. Puedes pedir «opciones AAAA-MM-DD» o volver al menú.");
  }

  async function process(phone: string, text: string, receivedAt: number, key?: string): Promise<PayrollResult> {
    const identity = await dependencies.lookupIdentity(phone);
    if (identity.status !== "active" || !identity.id) {
      contexts.delete(phone);
      return payroll.handleMessage(phone, text, key);
    }
    const owner = identity.id;
    const receiptKey = key && /^[A-Za-z0-9_.:+/=-]{1,512}$/.test(key)
      ? JSON.stringify([owner, key]) : null;
    const repeated = receiptKey ? receipts.has(receiptKey) : false;
    // Do not replay old promises/availability after time, cancellation or rescheduling.
    if (repeated) return reply("agenda_duplicate_ignored",
      "Este mensaje ya fue procesado; no repetí ninguna operación. Usa «consultar cita» para ver el estado actual.");

    for (const [sender, context] of contexts) {
      if (receivedAt - context.activity >= INACTIVITY_MS) contexts.delete(sender);
    }
    let context = contexts.get(phone);
    if (!context || context.owner !== owner) {
      // Reset only draft context. Tickets and agenda storage are independent.
      await payroll.handleMessage(phone, "cancelar");
      context = { owner, activity: receivedAt, phase: "idle", choices: [], offset: 0 };
    }
    contexts.set(phone, context);
    const input = normalizePayrollInput(text);
    let result: PayrollResult;
    try {
      if (NAV.test(input)) {
        contexts.delete(phone);
        result = await payroll.handleMessage(phone, text, key);
      } else if (context.ticketId && !agenda.active(context.ticketId, owner).length &&
        (/^(?:sin cita|no (?:quiero|deseo) agendar(?: una cita)?)$/.test(input) ||
          (context.phase === "offer" && input === "no"))) {
        const closed = await tickets.closeWithoutAppointment(context.ticketId, owner);
        context.ticketId = undefined;
        context.phase = "idle";
        await payroll.handleMessage(phone, "cancelar");
        result = reply("payroll_closed_without_appointment",
          `Ticket ficticio ${closed.folio}: cerrado sin cita por negativa expresa. El asunto NO está resuelto.`);
      } else if (/^(?:consultar|ver|mi|mis) (?:cita|citas|reserva|reservas)$/.test(input)) {
        const rows = agenda.forOwner(owner);
        context.phase = "idle";
        context.moving = false;
        context.choices = [];
        if (rows.length === 1) {
          context.ticketId = rows[0].ticketId;
          context.appointmentId = rows[0].id;
        }
        result = reply("agenda_query", rows.length
          ? rows.map((row, index) => `${index + 1}. ${describe(row)}`).join("\n")
          : "No hay una cita simulada vigente a tu nombre.");
      } else if (/^(?:cancelar|reprogramar)(?: (?:la|mi))? cita(?: \d+)?$/.test(input)) {
        const rows = agenda.forOwner(owner);
        const number = input.match(/ (\d+)$/);
        const selected = number ? rows[Number(number[1]) - 1] : rows.length === 1 ? rows[0] : undefined;
        if (!selected) {
          result = reply("agenda_choose_existing", rows.length
            ? `${rows.map((row, index) => `${index + 1}. ${describe(row)}`).join("\n")}\nIndica «cancelar cita N» o «reprogramar cita N».`
            : "No hay una cita simulada vigente que pueda modificar.");
        } else {
          context.ticketId = selected.ticketId;
          context.appointmentId = selected.id;
          context.phase = input.startsWith("cancelar") ? "confirm-cancel" : "confirm-move";
          result = reply("agenda_confirm_intent",
            `¿Confirmas que deseas ${context.phase === "confirm-cancel" ? "cancelar" : "reprogramar"} esta cita: ${describe(selected)}? Responde «confirmo» o «no». No modificaré el ticket como resuelto.`);
        }
      } else if (context.phase === "confirm-cancel" || context.phase === "confirm-move") {
        if (NO.test(input)) {
          context.phase = "idle";
          result = reply("agenda_intent_declined", "Conservé la reserva sin cambios.");
        } else if (!YES.test(input)) {
          result = reply("agenda_confirm_intent", "¿Confirmas el cambio solicitado? Responde «confirmo» o «no».");
        } else if (context.phase === "confirm-cancel") {
          if (!key) throw new AgendaError("MISSING_EVENT_KEY");
          agenda.cancel({ ticketId: context.ticketId!, collaboratorId: owner,
            id: context.appointmentId!, key, now: now() });
          context.phase = "idle";
          result = reply("agenda_cancelled", "Cita simulada cancelada. El ticket NO está resuelto.");
        } else {
          context.moving = true;
          context.offset = 0;
          result = offer(context);
        }
      } else if (context.phase === "confirm-book") {
        if (NO.test(input)) {
          context.offset = 0;
          result = offer(context);
        } else if (!YES.test(input)) {
          result = reply("agenda_confirmation_required", "Para registrar necesito «confirmo». Puedes responder «no» para elegir otra opción.");
        } else {
          if (!key) throw new AgendaError("MISSING_EVENT_KEY");
          const command = { ticketId: context.ticketId!, collaboratorId: owner,
            key, now: now(), start: context.selected! };
          const booked = context.moving
            ? agenda.reschedule({ ...command, id: context.appointmentId! })
            : agenda.book(command);
          context.phase = "idle";
          context.moving = false;
          context.appointmentId = booked.id;
          result = reply("agenda_registered", `Cita registrada SOLO en el simulador: ${describe(booked)} El asunto NO está resuelto.`);
        }
      } else if (context.ticketId && (/^(?:mas|otras) opciones$/.test(input) || /^opciones(?: \d{4}-\d{2}-\d{2})?$/.test(input))) {
        context.offset = /^(?:mas|otras)/.test(input) ? context.offset + 6 : 0;
        result = offer(context, input.match(/\d{4}-\d{2}-\d{2}/)?.[0]);
      } else if (context.phase === "select") {
        const selection = input.match(/^(?:opcion )?(\d+)[.)]?$/);
        const start = selection ? context.choices[Number(selection[1]) - 1] : undefined;
        if (start === undefined) {
          result = reply("agenda_select", "Elige un número de las opciones o pide otras opciones. No registré cambios.");
        } else {
          context.selected = start;
          context.phase = "confirm-book";
          result = reply("agenda_confirmation", `¿Confirmas ${context.moving ? "reprogramar a" : "reservar"} ${displayAppointment(start)}, presencial? Volveré a comprobar disponibilidad y anticipación antes de registrar.`);
        }
      } else if (context.ticketId && /^(?:si|agendar|agendar cita|reservar|reservar cita)$/.test(input)) {
        context.offset = 0;
        context.moving = false;
        result = offer(context);
      } else if (context.ticketId && agenda.active(context.ticketId, owner).length) {
        result = reply("agenda_existing", "Ya hay una cita simulada para este ticket. Puedes consultar cita, cancelar cita o reprogramar cita; el ticket no se cierra por esta respuesta.");
      } else {
        result = await payroll.handleMessage(phone, text, key);
        if (result.ticket && key) {
          const ticket = await tickets.findByConfirmation(key, owner);
          if (ticket && ticket.status === "pendiente de cita") {
            context.ticketId = ticket.id;
            context.phase = "offer";
            result.reply = `Simulación: ticket ficticio ${ticket.folio}, no guardado en Neon. ¿Deseas agendar una cita presencial simulada con RH? Responde sí o indica que no deseas agendar. No hay reserva real.`;
          }
        }
        if (result.action === "payroll_closed_without_appointment") {
          context.ticketId = undefined;
          context.phase = "idle";
        }
      }
    } catch (error) {
      if (!(error instanceof AgendaError)) throw error;
      if (["SLOT_UNAVAILABLE", "RESCHEDULE_UNAVAILABLE"].includes(error.code)) {
        context.phase = "select";
        context.choices = [];
        result = reply("agenda_unavailable", "La opción ya no está disponible o no cumple el margen de dos horas. No registré el cambio; si había reserva anterior, la conservé. Pide «opciones».");
      } else {
        result = reply("agenda_error", `No pude registrar la operación (${error.code}). No confirmo una nueva reserva. Puedes consultar cita o volver al menú.`);
      }
    }
    context.activity = receivedAt;
    if (receiptKey) receipts.add(receiptKey);
    return result;
  }

  function handleMessage(sender: string, message: string, key?: string) {
    const phone = String(sender ?? "").replace(/\D/g, "");
    const text = String(message ?? "").trim();
    if (!phone || !text) return payroll.handleMessage(phone, text, key);
    const receivedAt = now();
    const previous = queues.get(phone) ?? Promise.resolve();
    const task = previous.then(() => process(phone, text, receivedAt, key));
    const marker = task.then(() => {}, () => {});
    queues.set(phone, marker);
    return task.finally(() => { if (queues.get(phone) === marker) queues.delete(phone); });
  }
  return { handleMessage };
}
