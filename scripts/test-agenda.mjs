import assert from "node:assert/strict";
import { createMemoryTicketRepository } from "../src/lib/server/payroll-tickets.ts";
import { createSimulatedAgenda, AgendaError, INITIAL_WINDOWS } from "../src/lib/server/agenda-simulation.ts";
import { createAgendaReception } from "../src/lib/server/agenda-reception.ts";
import { mexicoInstant, localDate, displayAppointment, NOTICE_MS, SLOT_MS } from "../src/lib/server/agenda-time.ts";
import { dependencies, phone, prepare, services } from "./fixtures/payroll.mjs";

let groups = 0;
const monday = "2026-11-09";
const at = (date, time) => mexicoInstant(date, time);
const noon = at(monday, "12:00");
const start = at(monday, "14:00");
const isActivePayrollService = (id) => services.some((row) =>
  row.idServicio === id && row.categoria === "Nómina y prestaciones");
async function test(label, run) {
  await run();
  groups++;
  console.log(`${label}: PASS.`);
}
async function fixture() {
  const tickets = createMemoryTicketRepository();
  const a = await tickets.createConfirmed({
    collaboratorId: "SYNTHETIC-A", serviceId: "1", description: "Ficticio A",
    summary: "Ficticio A", confirmationId: "synthetic-ticket-a"
  });
  const b = await tickets.createConfirmed({
    collaboratorId: "SYNTHETIC-B", serviceId: "1", description: "Ficticio B",
    summary: "Ficticio B", confirmationId: "synthetic-ticket-b"
  });
  const agenda = createSimulatedAgenda({
    findTicket: (id) => tickets.snapshot().find((row) => row.id === id), isActivePayrollService
  });
  const cmd = (ticket = a, key = "synthetic-book") => ({
    ticketId: ticket.id, collaboratorId: ticket.collaboratorId, now: noon, key
  });
  return { tickets, a, b, agenda, cmd };
}
async function conversation(overrides = {}) {
  let time = noon;
  const tickets = createMemoryTicketRepository();
  const agenda = createSimulatedAgenda({
    findTicket: (id) => tickets.snapshot().find((row) => row.id === id), isActivePayrollService
  });
  const engine = createAgendaReception({ ...dependencies(), ...overrides }, tickets, agenda, { now: () => time });
  let sequence = 0;
  const send = (text, key = `synthetic-message-${++sequence}`) => engine.handleMessage(phone, text, key);
  return { tickets, agenda, engine, send, setTime: (value) => { time = value; } };
}
async function ticketFlow(c) {
  await prepare(c.engine);
  const result = await c.send("confirmo");
  assert.equal(result.action, "payroll_ticket_created");
  assert.match(result.reply, /simulada/);
  assert.equal(c.tickets.snapshot().length, 1);
}
async function selectFirst(c) {
  assert.equal((await c.send("sí")).action, "agenda_options");
  assert.equal((await c.send("1")).action, "agenda_confirmation");
}

await test("Ventana 14:00–17:30: diez bloques completos de 20 minutos consecutivos, sin buffer", async () => {
  const { agenda, cmd } = await fixture();
  const slots = agenda.list({ ...cmd(), date: monday, days: 1 });
  assert.equal(slots.length, 10);
  assert.equal(slots[0], start);
  assert.equal(slots.at(-1), at(monday, "17:00"));
  for (let i = 1; i < slots.length; i++) assert.equal(slots[i] - slots[i - 1], SLOT_MS);
  assert(!slots.includes(at(monday, "17:20")));
  assert.throws(() => agenda.book({ ...cmd(), start: at(monday, "17:20") }), /unavailable/);
});
await test("IANA America/Mexico_City y reloj simulado: fecha local distinta de UTC", async () => {
  assert.equal(new Date(start).toISOString(), "2026-11-09T20:00:00.000Z");
  assert.equal(localDate(Date.parse("2026-11-10T02:00:00Z")), monday);
  assert.match(displayAppointment(start), /09\/11\/2026 14:00–14:20 \(America\/Mexico_City\)/);
});
await test("Lunes-viernes sí; fines de semana, días sin ventana y bloqueos de día completo no", async () => {
  const { agenda, cmd } = await fixture();
  for (const date of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]) {
    assert.equal(agenda.list({ ...cmd(), date, days: 1 }).length, 10);
  }
  for (const date of ["2026-11-14", "2026-11-15"]) {
    assert.deepEqual(agenda.list({ ...cmd(), date, days: 1 }), []);
  }
  agenda.setWindows(INITIAL_WINDOWS.filter((row) => row.diaSemana !== 2));
  assert.deepEqual(agenda.list({ ...cmd(), date: "2026-11-10", days: 1 }), []);
  agenda.setBlocks([{ fecha: monday, horaInicio: "00:00", horaFin: "23:59" }]);
  assert.deepEqual(agenda.list({ ...cmd(), date: monday, days: 1 }), []);
});
await test("Mismo día: exactamente 120 minutos válido; 119m59s y pasado inválidos al ofrecer/registrar", async () => {
  for (const delta of [0, 1000]) {
    const { agenda, cmd } = await fixture();
    const now = start - NOTICE_MS + delta;
    assert.equal(agenda.list({ ...cmd(), now, date: monday, days: 1 }).includes(start), delta === 0);
    if (delta === 0) assert.equal(agenda.book({ ...cmd(), now, start }).start, start);
    else assert.throws(() => agenda.book({ ...cmd(), now, start }), { code: "SLOT_UNAVAILABLE" });
  }
  const { agenda, cmd } = await fixture();
  assert(!agenda.list({ ...cmd(), now: start + 1, date: monday, days: 1 }).includes(start));
});
await test("Bloqueos parciales excluyen todo solapamiento pero permiten extremos adyacentes", async () => {
  const { agenda, cmd } = await fixture();
  agenda.setBlocks([{ fecha: monday, horaInicio: "14:10", horaFin: "14:30" }]);
  const slots = agenda.list({ ...cmd(), date: monday, days: 1 });
  assert(!slots.includes(start));
  assert(!slots.includes(start + SLOT_MS));
  assert(slots.includes(start + 2 * SLOT_MS));
  agenda.setBlocks([{ fecha: monday, horaInicio: "14:20", horaFin: "14:40" }]);
  assert(agenda.list({ ...cmd(), date: monday, days: 1 }).includes(start));
});
await test("Ocupación única compartida: dos tickets simultáneos, solo uno obtiene el bloque", async () => {
  const { agenda, a, b, cmd } = await fixture();
  const results = await Promise.allSettled([
    Promise.resolve().then(() => agenda.book({ ...cmd(a, "race-a"), start })),
    Promise.resolve().then(() => agenda.book({ ...cmd(b, "race-b"), start }))
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(results.filter((row) => row.status === "rejected").length, 1);
  assert.equal(agenda.snapshot().length, 1);
  assert(!agenda.list({ ...cmd(b), date: monday, days: 1 }).includes(start));
  assert.equal(agenda.book({ ...cmd(b, "adjacent"), start: start + SLOT_MS }).start, start + SLOT_MS);
});
await test("Reintento simultáneo de misma confirmación: una reserva, mismo identificador, conflicto de clave rechazado", async () => {
  const { agenda, cmd, b } = await fixture();
  const [a, again] = await Promise.all([
    Promise.resolve().then(() => agenda.book({ ...cmd(), start })),
    Promise.resolve().then(() => agenda.book({ ...cmd(), start }))
  ]);
  assert.deepEqual(a, again);
  assert.equal(agenda.snapshot().length, 1);
  assert.throws(() => agenda.book({ ...cmd(b), start }), { code: "EVENT_CONFLICT" });
  assert.throws(() => agenda.book({ ...cmd(undefined, "different-event"), start: start + SLOT_MS }),
    { code: "ALREADY_BOOKED" });
});
await test("Cancelación confirmada libera ocupación; reintento no cambia ticket ni resuelve", async () => {
  const { agenda, tickets, cmd, b } = await fixture();
  const before = tickets.snapshot();
  const booked = agenda.book({ ...cmd(), start });
  const command = { ...cmd(undefined, "cancel"), id: booked.id };
  assert.equal(agenda.cancel(command).status, "cancelada");
  assert.equal(agenda.cancel(command).status, "cancelada");
  assert.equal(agenda.book({ ...cmd(b, "reuse"), start }).start, start);
  assert.deepEqual(tickets.snapshot(), before);
});
await test("Cancelar requiere 120 minutos; reprogramar valida margen de cita anterior y nueva", async () => {
  for (const delta of [0, 1000]) {
    const { agenda, cmd } = await fixture();
    const row = agenda.book({ ...cmd(), start });
    const command = { ...cmd(undefined, "cancel"), id: row.id, now: noon + delta };
    if (!delta) assert.equal(agenda.cancel(command).status, "cancelada");
    else assert.throws(() => agenda.cancel(command), { code: "CANCELLATION_UNAVAILABLE" });
  }
  const { agenda, cmd } = await fixture();
  const row = agenda.book({ ...cmd(), start });
  assert.throws(() => agenda.reschedule({ ...cmd(undefined, "late-move"), id: row.id,
    start: start + SLOT_MS, now: noon + 1000 }), { code: "RESCHEDULE_UNAVAILABLE" });
  assert.equal(agenda.snapshot()[0].start, start);
  const other = await fixture();
  const later = other.agenda.book({ ...other.cmd(), start: start + 2 * SLOT_MS });
  assert.throws(() => other.agenda.reschedule({ ...other.cmd(undefined, "new-time-too-soon"),
    id: later.id, start, now: noon + 1000 }), { code: "RESCHEDULE_UNAVAILABLE" });
  assert.equal(other.agenda.snapshot()[0].start, later.start);
});
await test("Reprogramar es todo-o-nada: ocupada falla y conserva original; éxito libera viejo horario", async () => {
  const { agenda, cmd, b, tickets } = await fixture();
  const before = tickets.snapshot();
  const original = agenda.book({ ...cmd(), start });
  agenda.book({ ...cmd(b, "other"), start: start + SLOT_MS });
  assert.throws(() => agenda.reschedule({ ...cmd(undefined, "fail-move"), id: original.id,
    start: start + SLOT_MS }), { code: "RESCHEDULE_UNAVAILABLE" });
  assert.equal(agenda.active(original.ticketId, original.collaboratorId)[0].start, start);
  const move = { ...cmd(undefined, "move"), id: original.id, start: start + 2 * SLOT_MS };
  assert.equal(agenda.reschedule(move).start, move.start);
  assert.equal(agenda.reschedule(move).id, original.id);
  assert(agenda.list({ ...cmd(), date: monday, days: 1 }).includes(start));
  assert.deepEqual(tickets.snapshot(), before);
  assert.equal(agenda.snapshot().length, 2);
});
await test("Configuración cambiante, bloqueos nuevos y horario desactivado se revalidan al confirmar", async () => {
  for (const change of [
    (agenda) => agenda.setBlocks([{ fecha: monday, horaInicio: "14:05", horaFin: "14:10" }]),
    (agenda) => agenda.setWindows([]),
    (agenda) => agenda.setWindows(INITIAL_WINDOWS.map((row) => ({ ...row, horaInicio: "14:20" })))
  ]) {
    const { agenda, cmd } = await fixture();
    assert(agenda.list({ ...cmd(), date: monday, days: 1 }).includes(start));
    change(agenda);
    assert.throws(() => agenda.book({ ...cmd(), start }), { code: "SLOT_UNAVAILABLE" });
    assert.equal(agenda.snapshot().length, 0);
  }
  const { agenda } = await fixture();
  assert.throws(() => agenda.setWindows([{ ...INITIAL_WINDOWS[0], duracionCita: 30 }]));
  assert.throws(() => agenda.setWindows([{ ...INITIAL_WINDOWS[0], diaSemana: 6 }]));
  assert.throws(() => agenda.setWindows([
    INITIAL_WINDOWS[0], { ...INITIAL_WINDOWS[0], horaInicio: "14:10" }
  ]), { code: "OVERLAPPING_WINDOWS" });
});
await test("Acceso propio, ticket cerrado y ausencia de ID técnico bloquean efectos", async () => {
  const { agenda, cmd, tickets, a } = await fixture();
  assert.throws(() => agenda.book({ ...cmd(), collaboratorId: "NOT-OWNER", start }), { code: "TICKET_NOT_FOUND" });
  assert.throws(() => agenda.book({ ...cmd(), key: "", start }), { code: "MISSING_EVENT_KEY" });
  await tickets.closeWithoutAppointment(a.id, a.collaboratorId);
  assert.throws(() => agenda.book({ ...cmd(), start }), { code: "TICKET_UNAVAILABLE" });
});
await test("Flujo completo 02-A → oferta → selección → confirmación → consulta; presencial y ticket vinculado", async () => {
  const c = await conversation();
  await ticketFlow(c);
  await selectFirst(c);
  assert.equal(c.agenda.snapshot().length, 0);
  const before = c.tickets.snapshot();
  assert.equal((await c.send("confirmo", "booking-event")).action, "agenda_registered");
  assert.equal(c.agenda.snapshot()[0].ticketId, before[0].id);
  assert.equal(c.agenda.snapshot()[0].modality, "presencial");
  const queried = await c.send("consultar cita");
  assert.equal(queried.action, "agenda_query");
  assert.match(queried.reply, /SIM-NOM-/);
  assert.deepEqual(c.tickets.snapshot(), before);
  assert.equal((await c.send("confirmo", "booking-event")).action, "agenda_duplicate_ignored");
  assert.equal(c.agenda.snapshot().length, 1);
});
await test("Elección vence antes de confirmar: 119m59s no registra ni promete éxito", async () => {
  const c = await conversation();
  await ticketFlow(c);
  await selectFirst(c);
  c.setTime(noon + 1000);
  const result = await c.send("confirmo");
  assert.equal(result.action, "agenda_unavailable");
  assert.equal(c.agenda.snapshot().length, 0);
  assert.match(result.reply, /No registré/);
});
await test("Conversación revalida bloqueo y ocupación posteriores a la oferta", async () => {
  const c = await conversation();
  await ticketFlow(c);
  await selectFirst(c);
  c.agenda.setBlocks([{ fecha: monday, horaInicio: "14:00", horaFin: "14:01" }]);
  assert.equal((await c.send("confirmo")).action, "agenda_unavailable");
  assert.equal((await c.send("opciones")).action, "agenda_options");
  assert.equal((await c.send("opciones 2026-02-30")).action, "agenda_error");
});
await test("Cancelar y reprogramar piden intención; no ambiguo no cambia; reprogramar conserva una ocupación", async () => {
  const c = await conversation();
  await ticketFlow(c);
  await selectFirst(c);
  await c.send("confirmo");
  const before = c.tickets.snapshot();
  assert.equal((await c.send("cancelar cita")).action, "agenda_confirm_intent");
  assert.equal((await c.send("tal vez")).action, "agenda_confirm_intent");
  assert.equal(c.agenda.snapshot()[0].status, "confirmada");
  assert.equal((await c.send("no")).action, "agenda_intent_declined");
  assert.equal((await c.send("reprogramar cita")).action, "agenda_confirm_intent");
  assert.equal((await c.send("confirmo")).action, "agenda_options");
  await c.send("1");
  assert.equal((await c.send("confirmo")).action, "agenda_registered");
  assert.equal(c.agenda.snapshot().length, 1);
  assert.equal(c.agenda.snapshot()[0].start, start + SLOT_MS);
  await c.send("cancelar cita");
  assert.equal((await c.send("confirmo", "cancel-event")).action, "agenda_cancelled");
  assert.equal((await c.send("confirmo", "cancel-event")).action, "agenda_duplicate_ignored");
  assert.equal((await c.send("consultar cita")).action, "agenda_query");
  assert.deepEqual(c.agenda.forOwner(before[0].collaboratorId), []);
  assert.deepEqual(c.tickets.snapshot(), before);
});
await test("Negativa expresa cierra sin cita/no resuelto; cancelar menú y silencio no cierran", async () => {
  for (const stage of ["offer", "select"]) {
    const c = await conversation();
    await ticketFlow(c);
    if (stage === "select") await c.send("sí");
    assert.equal((await c.send("no quiero agendar")).action, "payroll_closed_without_appointment");
    assert.equal(c.tickets.snapshot()[0].resolvedAt, null);
    assert.equal(c.tickets.snapshot()[0].status, "cerrado sin cita");
    assert.equal(c.agenda.snapshot().length, 0);
  }
  const c = await conversation();
  await ticketFlow(c);
  await c.send("cancelar");
  assert.equal(c.tickets.snapshot()[0].status, "pendiente de cita");
});
await test("Caducidad exacta de dos horas no borra reservas; consulta tras reiniciar motor las recupera en simulación compartida", async () => {
  const c = await conversation();
  await ticketFlow(c);
  await selectFirst(c);
  await c.send("confirmo", "register");
  c.setTime(noon + NOTICE_MS);
  await c.send("hola");
  assert.equal(c.agenda.snapshot()[0].status, "confirmada");
  assert.equal((await c.send("consultar cita")).action, "agenda_query");
  const fresh = createAgendaReception(dependencies(), c.tickets, c.agenda, { now: () => noon + NOTICE_MS });
  assert.match((await fresh.handleMessage(phone, "consultar cita", "fresh-query")).reply, /SIM-NOM-/);
  assert.equal(c.tickets.snapshot()[0].resolvedAt, null);
});
await test("Contexto a 119m59s continúa; a 120m se descarta selección sin reservar", async () => {
  for (const delta of [-1000, 0]) {
    const c = await conversation();
    c.setTime(at(monday, "09:00"));
    await ticketFlow(c);
    await selectFirst(c);
    c.setTime(at(monday, "09:00") + NOTICE_MS + delta);
    const result = await c.send("confirmo");
    assert.equal(result.action === "agenda_registered", delta < 0);
    assert.equal(c.agenda.snapshot().length, delta < 0 ? 1 : 0);
  }
});
await test("Duplicados no renuevan actividad; identidad revocada no consulta ni modifica reservas", async () => {
  let active = true;
  const deps = dependencies();
  const c = await conversation({ lookupIdentity: async (sender) => active
    ? deps.lookupIdentity(sender) : { status: "inactive", id: null } });
  await ticketFlow(c);
  await c.send("sí", "offer-event");
  c.setTime(noon + NOTICE_MS - 1000);
  assert.equal((await c.send("sí", "offer-event")).action, "agenda_duplicate_ignored");
  c.setTime(noon + NOTICE_MS);
  assert.notEqual((await c.send("1")).action, "agenda_confirmation");
  active = false;
  assert.equal((await c.send("consultar cita")).action, "access_denied");
});
await test("Dos motores comparten recurso institucional; agenda vacía nueva pierde datos, límite explícito de memoria", async () => {
  const c = await conversation();
  await ticketFlow(c);
  await selectFirst(c);
  await c.send("confirmo");
  const another = createSimulatedAgenda({
    findTicket: (id) => c.tickets.snapshot().find((row) => row.id === id), isActivePayrollService
  });
  assert.equal(another.snapshot().length, 0);
  assert.equal(c.agenda.snapshot().length, 1);
  const secondEngine = createAgendaReception(dependencies(), c.tickets, c.agenda, { now: () => noon });
  assert.match((await secondEngine.handleMessage(phone, "consultar cita", "second-engine")).reply, /SIM-NOM-/);
  assert.throws(() => createAgendaReception(dependencies(),
    { ...c.tickets, mode: "neon" }, c.agenda), { code: "SIMULATION_ONLY" });
});
await test("Fallo del repositorio no genera mensaje de reserva confirmada ni efectos", async () => {
  const c = await conversation();
  await ticketFlow(c);
  const failing = createAgendaReception(dependencies(), c.tickets,
    { ...c.agenda, cancel() { throw new AgendaError("SIMULATED_STORAGE_FAILURE"); } },
    { now: () => noon });
  await selectFirst(c);
  await c.send("confirmo");
  await failing.handleMessage(phone, "cancelar cita", "cancel-intent");
  const result = await failing.handleMessage(phone, "confirmo", "cancel-failure");
  assert.equal(result.action, "agenda_error");
  assert.match(result.reply, /No pude registrar/);
  assert.equal(c.agenda.snapshot()[0].status, "confirmada");
});
await test("Un servicio no nómina o retirado nunca permite reservar; catálogo no se inventa", async () => {
  const { tickets, a } = await fixture();
  const agenda = createSimulatedAgenda({
    findTicket: (id) => tickets.snapshot().find((row) => row.id === id),
    isActivePayrollService: () => false
  });
  assert.throws(() => agenda.book({
    ticketId: a.id, collaboratorId: a.collaboratorId, key: "invalid-service", start, now: noon
  }), { code: "PAYROLL_SERVICE_UNAVAILABLE" });
  assert.equal(agenda.snapshot().length, 0);
});
await test("Varias citas del mismo propietario: pide cuál, no cancela una reserva arbitraria", async () => {
  const c = await conversation();
  await ticketFlow(c);
  await selectFirst(c);
  await c.send("confirmo");
  const owner = c.tickets.snapshot()[0].collaboratorId;
  const another = await c.tickets.createConfirmed({
    collaboratorId: owner, serviceId: "1", description: "Otra aclaración ficticia",
    summary: "Ficticia", confirmationId: "another-confirmation"
  });
  c.agenda.book({ ticketId: another.id, collaboratorId: owner,
    key: "another-booking", start: start + SLOT_MS, now: noon });
  assert.equal((await c.send("cancelar cita")).action, "agenda_choose_existing");
  assert.equal(c.agenda.forOwner(owner).length, 2);
  assert.equal((await c.send("cancelar cita 2")).action, "agenda_confirm_intent");
  await c.send("confirmo");
  assert.equal(c.agenda.forOwner(owner).length, 1);
  assert.equal(c.agenda.forOwner(owner)[0].ticketId, c.tickets.snapshot()[0].id);
});
console.log(`Agenda 02-B: ${groups} grupos PASS; solo memoria ficticia, sin Neon ni transporte WhatsApp.`);
