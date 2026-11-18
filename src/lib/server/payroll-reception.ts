import { createConversationManager } from "./whatsapp-conversation.js";
import type { ActiveService } from "./neon-collaborators.ts";
import type { Identity, Ticket, TicketRepository } from "./payroll-tickets.ts";
import { TicketError } from "./payroll-tickets.ts";
import { requireEventId } from "./persistence-unit.ts";
import { displayFriday, normalizePayrollInput, parseFriday } from "./payroll-dates.ts";
import { messageCache, periodic, stateSweeper, type MemoryOptions } from "./conversation-memory.ts";

export const INACTIVITY_MS = 120 * 60 * 1000;
const PAYROLL = "Nómina y prestaciones";
const YES = /^(?:si(?:,? confirmo)?|confirmo|confirmar|correcto|de acuerdo)$/;
const NO_APPOINTMENT = /^(?:no|sin cita|no (?:quiero|deseo) (?:agendar(?: una cita)?|(?:una )?cita)|rechazo agendar)$/;

type Result = {
  collaboratorStatus: Identity["status"];
  action: string;
  reply: string;
  classification: "clasificado" | "sin clasificar" | null;
  serviceId?: string;
  ticket?: { folio: string; status: string; persistence: TicketRepository["mode"] };
};
type Dependencies = {
  lookupIdentity(phone: string): Promise<Identity>;
  listActiveServices(): Promise<ActiveService[]>;
  classifyService(text: string, services: ActiveService[]): Promise<{
    serviceId: string | null; classification: "clasificado" | "sin clasificar";
  }>;
};
type Draft = {
  serviceId: string | null;
  friday: string | null;
  candidate: string | null;
  description: string | null;
  needsConcept?: boolean;
  otherConcept?: boolean;
  phase: "collect" | "confirm" | "correct" | "offer";
  correction?: "topic" | "friday" | "description";
  confirmationKey?: string;
  ticket?: Pick<Ticket, "id" | "folio" | "status">;
};
type Session = { ownerId: string; lastActivity: number; draft?: Draft };

function answer(action: string, reply: string): Result {
  return { collaboratorStatus: "active", action, reply, classification: null };
}

function serviceMenu(services: ActiveService[]): string {
  const menuServices = services.filter((service) =>
    normalizePayrollInput(service.subcategoria ?? "") !== "gasolina"
  );
  return `¿Qué tipo de pago quieres aclarar? Puedes elegir una opción o contármelo con tus palabras.\n${menuServices.map(
    (service, index) => `${index + 1}. ${service.subcategoria}`
  ).join("\n")}\nElige un número o cuéntame qué ocurrió.`;
}

function validMessageId(value: string | undefined): value is string {
  try { requireEventId(value!); return true; } catch { return false; }
}

function specificPayrollService(text: string, services: ActiveService[]): ActiveService | undefined {
  const input = normalizePayrollInput(text);
  if (/\b(?:requisitos?|reglas?|obtener|calificar)\b/.test(input)) return undefined;
  const patterns: [RegExp, string][] = [
    [/\b(?:sueldo|salario)\b/, "Pago semanal"],
    [/\bbonos?\b/, "Otros"],
    [/\b(?:premio|puntualidad|asistencia)\b/, "Premios de puntualidad y asistencia"],
    [/\b(?:horas? extra|tiempo extra|tiempo extraordinario)\b/, "Horas extra"],
    [/\b(?:despensa|vales?)\b/, "Despensa"],
    [/\b(?:gasolina|combustible)\b/, "Gasolina"],
    [/\b(?:recibo|comprobante|cfdi)\b/, "Recibo de nómina"],
    [/\bdescuento(?:s)?\b/, "Descuentos"]
  ];
  const label = patterns.find(([pattern]) => pattern.test(input))?.[1];
  return label ? services.find((service) => normalizePayrollInput(service.subcategoria ?? "") ===
    normalizePayrollInput(label)) : undefined;
}

/** Composes the approved menu engine; no scheduling or outbound transport. */
export function createPayrollReception(
  dependencies: Dependencies,
  repository: TicketRepository,
  options: MemoryOptions & { isBusy?: (phone: string) => boolean } = {}
) {
  const now = options.now ?? Date.now;
  const base = createConversationManager({
    lookupCollaborator: async (phone) => (await dependencies.lookupIdentity(phone)).status,
    listActiveServices: dependencies.listActiveServices,
    classifyService: dependencies.classifyService
  });
  const sessions = new Map<string, Session>();
  const queues = new Map<string, Promise<void>>();
  let disposed = false;
  const seen = messageCache(options);
  const collectStates = stateSweeper(sessions,
    session => now() - session.lastActivity >= INACTIVITY_MS,
    phone => queues.has(phone) || Boolean(options.isBusy?.(phone)),
    phone => { base.sessionStore.delete(phone); });
  function pruneExpired() { collectStates(); seen.sweep(); }
  const stop = periodic(pruneExpired, options);

  function ticketResult(ticket: Pick<Ticket, "folio" | "status">, action: string): Result {
    const prefix = repository.mode === "simulation"
      ? "Simulación: ticket ficticio, no guardado en Neon."
      : "Ticket registrado.";
    const closed = ticket.status === "cerrado sin cita";
    return {
      ...answer(action, `${prefix} Folio: ${ticket.folio}.\n${closed
        ? "Cerrado sin cita por negativa expresa. El asunto NO está resuelto."
        : "¿Deseas agendar una cita presencial con RH? La reserva se habilitará en la iteración 02-B; en esta fase no se reserva ninguna cita."}`),
      ticket: { folio: ticket.folio, status: ticket.status, persistence: repository.mode }
    };
  }

  function summary(draft: Draft, service: ActiveService): string {
    return `Tema: ${service.subcategoria}\nFecha del pago: ${displayFriday(draft.friday!)}\nLo que pasó: ${draft.description}`;
  }

  function advance(draft: Draft, services: ActiveService[]): Result {
    const service = services.find((row) => row.idServicio === draft.serviceId);
    if (!service) {
      draft.serviceId = null;
      draft.phase = "collect";
      return answer("payroll_topic", serviceMenu(services));
    }
    if (draft.candidate) return answer("payroll_friday_candidate",
      `¿Te refieres al viernes ${displayFriday(draft.candidate)}?`);
    if (!draft.friday) return answer("payroll_friday",
      "¿De qué viernes fue el pago: el pasado, el antepasado o alguna otra fecha? Después cuéntame brevemente qué no coincide.");
    if (draft.needsConcept) return answer("payroll_concept",
      "Cuéntame brevemente qué pasó con tu pago. Si te ayuda, por ejemplo: el sueldo, el premio de puntualidad y asistencia, el tiempo extra o la despensa.");
    if (!draft.description) {
      const prompt = draft.otherConcept
        ? "¿Cuál es ese otro concepto y qué ocurrió? Cuéntamelo brevemente con tus palabras."
        : service.subcategoria === "Pago semanal"
          ? "Cuéntame brevemente qué pasó. Por ejemplo: el premio de puntualidad y asistencia, el tiempo extra o la despensa."
          : service.subcategoria === "Premios de puntualidad y asistencia"
            ? "¿Qué pasó con tu premio de puntualidad y asistencia? Cuéntamelo brevemente con tus palabras."
            : service.subcategoria === "Horas extra"
              ? "¿Qué pasó con el tiempo extra? Cuéntamelo brevemente con tus palabras."
              : service.subcategoria === "Despensa"
                ? "¿Qué pasó con la despensa? Cuéntamelo brevemente con tus palabras."
                : `¿Qué ocurrió con ${service.subcategoria}? Cuéntamelo brevemente con tus palabras.`;
      return answer("payroll_explanation", prompt);
    }
    draft.phase = "confirm";
    return answer("payroll_summary",
      `Revisa si lo entendí bien:\n${summary(draft, service)}\n\n¿Lo registro para que RH lo revise?`);
  }

  function takeDate(draft: Draft, text: string): boolean {
    const reference = parseFriday(text, now());
    if (reference.kind !== "explicit" && reference.kind !== "candidate") return false;
    draft.friday = reference.kind === "explicit" ? reference.date : null;
    draft.candidate = reference.kind === "candidate" ? reference.date : null;
    return true;
  }

  async function payroll(
    draft: Draft, identity: Identity, text: string, key: string | undefined
  ): Promise<Result> {
    const input = normalizePayrollInput(text);
    if (draft.phase === "offer" && draft.ticket) {
      if (NO_APPOINTMENT.test(input)) {
        const closed = await repository.closeWithoutAppointment(draft.ticket.id, identity.id!);
        draft.ticket = { id: closed.id, folio: closed.folio, status: closed.status };
        return ticketResult(closed, "payroll_closed_without_appointment");
      }
      if (draft.ticket.status === "cerrado sin cita") return ticketResult(draft.ticket, "payroll_already_closed");
      return answer("payroll_no_booking",
        YES.test(input)
          ? "Entendido. En esta simulación la cita aún NO está reservada; la agenda corresponde a 02-B. El ticket sigue pendiente de cita y no está resuelto."
          : "No tomaré esa respuesta como rechazo. ¿Deseas agendar una cita presencial? Responde sí o expresa que no deseas agendar. En 02-A no se realizan reservas.");
    }

    const catalog = await dependencies.listActiveServices();
    const services = catalog.filter((service) => service.categoria === PAYROLL);
    if (services.length !== 8) throw new TicketError("PAYROLL_CATALOG_UNAVAILABLE");
    if (draft.serviceId && !services.some((service) => service.idServicio === draft.serviceId)) {
      draft.serviceId = null;
      draft.phase = "collect";
      return answer("payroll_topic", serviceMenu(services));
    }

    if (/^(?:corregir|corrijo|me equivoque|quiero corregir|no era|quise decir)\b/.test(input) ||
        (draft.phase === "confirm" && input === "no")) {
      draft.phase = "correct";
      return answer("payroll_correct", "¿Qué quieres corregir: la fecha del pago, el tema de la consulta o lo que explicaste?");
    }
    if (draft.phase === "correct") {
      if (/^(?:tipo(?: de (?:consulta|pago))?|tema|concepto|servicio)$/.test(input)) {
        draft.serviceId = null;
        draft.description = null;
        draft.needsConcept = false;
        draft.otherConcept = false;
        draft.correction = "topic";
      } else if (/^(?:viernes(?: de pago)?|fecha(?: de pago)?|semana)$/.test(input)) {
        draft.friday = null; draft.candidate = null; draft.correction = "friday";
      } else if (/^(?:lo que paso|explicacion|relato|descripcion)$/.test(input)) {
        draft.description = null; draft.correction = "description";
      } else {
        return answer("payroll_correct", "Elige qué quieres cambiar: la fecha del pago, el tema de la consulta o lo que explicaste.");
      }
      draft.phase = "collect";
      return advance(draft, services);
    }

    if (draft.phase === "confirm") {
      if (!YES.test(input)) return answer("payroll_confirm_required",
        "Para registrar necesito que confirmes expresamente el resumen. Puedes escribir «confirmo», corregir o cancelar.");
      if (!validMessageId(key)) return answer("payroll_missing_confirmation_id",
        "No pude identificar este mensaje para evitar duplicados. No registré el ticket; vuelve a confirmar desde un mensaje identificable de WhatsApp.");
      const service = services.find((service) => service.idServicio === draft.serviceId)!;
      draft.confirmationKey = key;
      const ticket = await repository.createConfirmed({
        collaboratorId: identity.id!, serviceId: service.idServicio,
        description: draft.description!, summary: summary(draft, service), confirmationId: key
      });
      draft.ticket = { id: ticket.id, folio: ticket.folio, status: ticket.status };
      draft.phase = "offer";
      // Drop draft narrative after persistence; only ticket identity/state is needed.
      draft.description = null; draft.friday = null; draft.candidate = null;
      return ticketResult(ticket, "payroll_ticket_created");
    }

    if (draft.candidate) {
      if (YES.test(input)) {
        draft.friday = draft.candidate; draft.candidate = null;
      } else if (input === "no") {
        draft.candidate = null;
      } else if (!takeDate(draft, text)) {
        return answer("payroll_friday_candidate", "¿Confirmas ese viernes? Si no, indica la fecha completa correcta.");
      }
      return advance(draft, services);
    }

    if (!draft.serviceId) {
      const menuServices = services.filter((service) =>
        normalizePayrollInput(service.subcategoria ?? "") !== "gasolina"
      );
      const option = input.match(/^(?:opcion )?([1-7])[.)]?$/);
      const byLabel = services.find((service) =>
        normalizePayrollInput(service.subcategoria ?? "") === input);
      if (option || byLabel) {
        draft.serviceId = (option ? menuServices[Number(option[1]) - 1] : byLabel)!.idServicio;
        draft.needsConcept = false;
        delete draft.correction;
        return advance(draft, services);
      }
      const classification = await dependencies.classifyService(text, catalog);
      const explicitConcept = specificPayrollService(text, services);
      const selected = explicitConcept ?? services.find((service) => service.idServicio === classification.serviceId);
      if (!selected || classification.classification !== "clasificado") {
        return answer("payroll_topic", `No pude ubicar un concepto activo de nómina. Si son requisitos de una política, puedes volver al menú.\n${serviceMenu(services)}`);
      }
      draft.serviceId = selected.idServicio;
      draft.needsConcept = selected.subcategoria === "Pago semanal" && !explicitConcept;
      if (text.length <= 1000 && text.length >= 12) draft.description = text;
      takeDate(draft, text);
      return advance(draft, services);
    }

    if (!draft.friday) {
      if (!takeDate(draft, text)) return answer("payroll_friday",
        "Necesito precisar el viernes: indica día, mes y año y comprueba que sea viernes. No asumiré la fecha del pago.");
      return advance(draft, services);
    }
    if (draft.needsConcept) {
      const concept = specificPayrollService(text, services);
      if (concept) {
        draft.serviceId = concept.idServicio;
        draft.needsConcept = false;
        draft.otherConcept = concept.subcategoria === "Otros";
        draft.description = /\b(?:no|falt\w*|recib\w*|pag\w*|aparec\w*|difer\w*|incomplet\w*|incorrect\w*|deben|descont\w*)\b/.test(input)
          ? text.replace(/\s+/g, " ").trim() : null;
        return advance(draft, services);
      }
      if (/^(?:otro|otra|otro concepto)$/.test(input)) {
        draft.needsConcept = false;
        draft.otherConcept = true;
        draft.description = null;
        return advance(draft, services);
      }
      if (text.length >= 12 && text.length <= 1000 && !YES.test(input)) {
        draft.needsConcept = false;
        draft.description = text.replace(/\s+/g, " ").trim();
        draft.otherConcept = false;
        delete draft.correction;
        return advance(draft, services);
      }
      return answer("payroll_concept",
        "Cuéntame brevemente qué pasó con tu pago. Si te ayuda, por ejemplo: el sueldo, el premio de puntualidad y asistencia, el tiempo extra o la despensa.");
    }
    if (!draft.description) {
      if (text.length < 12 || text.length > 1000 || YES.test(input)) return answer("payroll_explanation",
        "Cuéntame brevemente con tus palabras qué ocurrió; una frase basta.");
      if (draft.otherConcept) {
        const identified = specificPayrollService(text, services);
        if (identified) draft.serviceId = identified.idServicio;
      }
      draft.description = text.replace(/\s+/g, " ").trim();
      draft.otherConcept = false;
      delete draft.correction;
    }
    return advance(draft, services);
  }

  async function process(phone: string, text: string, receivedAt: number, key?: string): Promise<Result> {
    const identity = await dependencies.lookupIdentity(phone);
    if (identity.status !== "active" || !identity.id) {
      sessions.delete(phone); base.sessionStore.delete(phone);
      return { collaboratorStatus: identity.status === "active" ? "ambiguous" : identity.status,
        action: "access_denied", reply: "Este número no está autorizado en el directorio activo de RH.", classification: null };
    }
    let session = sessions.get(phone);
    if (session && (session.ownerId !== identity.id || receivedAt - session.lastActivity >= INACTIVITY_MS)) {
      sessions.delete(phone); base.sessionStore.delete(phone); session = undefined;
    }
    // Durable lookup works without a session. It never revives an expired draft.
    if (validMessageId(key)) {
      const prior = await repository.findByConfirmation(key, identity.id);
      if (prior) {
        const draft = session?.draft;
        if (draft?.confirmationKey === key) {
          draft.phase = "offer";
          draft.ticket = { id: prior.id, folio: prior.folio, status: prior.status };
          draft.description = null; draft.friday = null; draft.candidate = null;
        }
        const result = ticketResult(prior, "payroll_ticket_replayed");
        if (draft?.ticket?.id !== prior.id) {
          result.reply = `${repository.mode === "simulation" ? "Simulación, sin registro en Neon. " : ""}La confirmación ya fue registrada con folio ${prior.folio}. No repetí la operación ni recuperé el diálogo anterior. Puedes iniciar una nueva atención desde el menú.`;
        }
        return result;
      }
    }
    session ??= { ownerId: identity.id, lastActivity: receivedAt };
    const seenKey = validMessageId(key) ? JSON.stringify([identity.id, key]) : null;
    if (seenKey && seen.get(seenKey) !== undefined) return answer("duplicate_ignored",
      "Este mensaje ya fue recibido; no repetí la operación.");
    // Track new sessions even when a later dependency fails after menu mutation.
    sessions.set(phone, session);
    const input = normalizePayrollInput(text);
    const navigation = /^(?:cancelar|cancela|salir|menu(?: principal)?|inicio|regresar|volver|atras|anterior)$/.test(input);
    let result: Result;
    if (navigation) {
      delete session.draft;
      result = await base.handleMessage(phone, text);
      if (result.action === "cancelled") result.reply =
        "Listo, reinicié la conversación. Los tickets ya registrados no se modifican ni se consideran resueltos.";
    } else if (session.draft) {
      result = await payroll(session.draft, identity, text, key);
    } else {
      result = await base.handleMessage(phone, text);
      if (base.sessionStore.get(phone)?.category === "payroll") {
        const catalog = await dependencies.listActiveServices();
        const services = catalog.filter((service) => service.categoria === PAYROLL);
        if (services.length !== 8) throw new TicketError("PAYROLL_CATALOG_UNAVAILABLE");
        const explicitConcept = specificPayrollService(text, services);
        const service = explicitConcept ?? services.find((row) => row.idServicio === result.serviceId);
        const draft: Draft = { serviceId: service?.idServicio ?? null,
          friday: null, candidate: null, description: null, phase: "collect",
          needsConcept: service?.subcategoria === "Pago semanal" && !explicitConcept };
        if (service && text.length >= 12 && text.length <= 1000 &&
            normalizePayrollInput(service.subcategoria ?? "") !== input) {
          draft.description = text.replace(/\s+/g, " ").trim();
          takeDate(draft, text);
        }
        session.draft = draft;
        const prompt = advance(draft, services);
        if (/Hola, soy Catarina/.test(result.reply) &&
            /^(?:hola|buenos dias|buenas tardes|buenas noches)$/.test(input)) {
          prompt.reply = `Hola, soy Catarina, recepcionista de RH. ${prompt.reply}`;
        }
        result = { ...prompt, classification: result.classification };
      } else {
        result.reply = result.reply.replace(
          "En esta etapa solo simulamos la recepción: no resuelvo asuntos ni registro trámites.",
          "Simulamos la recepción de nómina con ticket ficticio tras confirmar el resumen. No resuelvo pagos ni reservo citas; políticas y Tu Voz continúan sin registro."
        );
      }
    }
    session.lastActivity = receivedAt;
    if (seenKey) seen.set(seenKey, "");
    sessions.set(phone, session);
    return result;
  }

  function handleMessage(senderPhone: string, messageText: string, messageId?: string): Promise<Result> {
    if (disposed) return Promise.reject(new TicketError("MEMORY_RUNTIME_DISPOSED"));
    const phone = String(senderPhone ?? "").replace(/\D/g, "");
    const text = String(messageText ?? "").trim();
    if (!phone || !text) return Promise.resolve({
      collaboratorStatus: "not_found", action: "ignored", reply: "", classification: null
    });
    pruneExpired();
    const receivedAt = now();
    const previous = queues.get(phone) ?? Promise.resolve();
    const task = previous.then(() => process(phone, text, receivedAt, messageId));
    const marker = task.then(() => {}, () => {});
    queues.set(phone, marker);
    return task.finally(() => {
      if (queues.get(phone) === marker) queues.delete(phone);
      if (disposed) releaseIdle();
    });
  }
  function reset(senderPhone: string) {
    const phone=String(senderPhone??"").replace(/\D/g,"");
    sessions.delete(phone);base.sessionStore.delete(phone);
  }
  function releaseIdle() {
    for (const phone of sessions.keys()) {
      if (!queues.has(phone) && !options.isBusy?.(phone)) {
        sessions.delete(phone); base.sessionStore.delete(phone);
      }
    }
    if (!queues.size) seen.clear();
  }
  return { handleMessage, pruneExpired, reset,
    exportState(phone:string) {
      return {menu:structuredClone(base.sessionStore.get(phone)??null),
        nomina:structuredClone(sessions.get(phone)??null)};
    },
    importState(phone:string,state:{menu?:unknown;nomina?:unknown}) {
      reset(phone);
      if(state.menu)base.sessionStore.set(phone,structuredClone(state.menu) as never);
      if(state.nomina)sessions.set(phone,structuredClone(state.nomina) as Session);
    },
    memoryStats: () => ({ sessions: sessions.size, menus: base.sessionStore.size,
      queued: queues.size, cache: seen.stats() }),
    dispose() { disposed = true; stop(); releaseIdle(); }
  };
}
