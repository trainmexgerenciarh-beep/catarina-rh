import assert from "node:assert/strict";
import { fakeDatabase } from "./fixtures/persistent-agenda.mjs";
import { createNeonAgendaRepository } from "../src/lib/server/neon-agenda.ts";
import { createNeonTicketRepository } from "../src/lib/server/payroll-tickets.ts";
import { commandFingerprint } from "../src/lib/server/agenda-persistence-contract.ts";
import { AGENDA_LOCK_KEY } from "../src/lib/server/persistence-unit.ts";

const start = "2026-11-16T20:00:00.000Z"; // Monday 14:00 Mexico, fictional frozen clock.
let groups = 0;
const repository = db => createNeonAgendaRepository(db.pool, { mode: "SIMULATION_ONLY" });
const command = (label, extra = {}) => ({
  eventId: `wamid.SYNTHETIC-${label}`, collaboratorId: "SYNTHETIC-A",
  ticketId: "1", operation: "RESERVAR", start, modality: "PRESENCIAL", confirmed: true, ...extra
});
const rejects = (fn, code) => assert.rejects(fn, e => e.code === code && !e.message.includes("PRIVATE"));
async function test(name, run) { await run(); groups++; console.log(`${name}: PASS.`); }
const cancel = (label, id, extra = {}) => command(label, {
  operation: "CANCELAR", appointmentId: id, start: undefined, ...extra
});
const move = (label, id, extra = {}) => command(label, {
  operation: "REPROGRAMAR", appointmentId: id, start: "2026-11-16T20:20:00.000Z", ...extra
});

await test("Gate explícito, evento obligatorio, confirmación y canonización sin datos personales", async () => {
  const db = fakeDatabase();
  assert.throws(() => createNeonAgendaRepository(db.pool, { mode: "LIVE" }), { code: "SIMULATION_ONLY_REQUIRED" });
  for (const eventId of ["", " ", " bad", "bad\n"]) {
    assert.throws(() => repository(db).execute(command("bad", { eventId })), { code: "MISSING_EVENT_ID" });
  }
  assert.throws(() => repository(db).execute(command("unconfirmed", { confirmed: false })), { code: "INVALID_COMMAND" });
  assert.throws(() => repository(db).execute(command("date", { start: "2026-02-30T20:00:00Z" })), { code: "INVALID_INSTANT" });
  assert.equal(commandFingerprint(command("a")), commandFingerprint(command("b", { start: "2026-11-16T14:00:00-06:00" })));
  assert.equal(db.connections, 0);
});

await test("Reserva/recibo atómicos, BIGINT texto, una conexión y mismo bloqueo global", async () => {
  const db = fakeDatabase(), repo = repository(db);
  const r = await repo.execute(command("book"));
  assert.equal(r.version, 1); assert.equal(r.status, "PROGRAMADA");
  assert.equal(db.snapshot().receipts.length, 1); assert.equal(db.snapshot().appointments.length, 1);
  assert.equal(new Set(db.calls.map(c => c.connection)).size, 1);
  assert.equal(db.calls.find(c => c.sql.includes("advisory")).params[0], AGENDA_LOCK_KEY);
  assert.equal(db.calls.at(-1).sql, "COMMIT");
  assert.ok(db.calls.findIndex(c => c.sql.includes("c2:clock")) > db.calls.findIndex(c => c.sql.includes("advisory")));
  assert.deepEqual(db.snapshot().tickets.map(t => [t.closedAt, t.resolvedAt]), [[null, null], [null, null], [null, null], [null, null]]);
  const big = "9007199254740993";
  const other = fakeDatabase(); other.edit(d => { d.tickets[0].id = big; });
  assert.equal((await repository(other).execute(command("big", { ticketId: big }))).ticketId, big);
});

await test("Mismo evento simultáneo y repositorios nuevos: resultado original sin mutación", async () => {
  const db = fakeDatabase();
  const results = await Promise.all([repository(db).execute(command("same")), repository(db).execute(command("same"))]);
  assert.deepEqual(results[0], results[1]); assert.equal(db.snapshot().receipts.length, 1);
  assert.equal(db.snapshot().appointments.length, 1);
  assert.equal(db.calls.filter(c => c.sql.includes("c2:book")).length, 1);
});

await test("Clave reutilizada con huella distinta rechazada; recibo leído antes del contexto/ticket", async () => {
  const db = fakeDatabase(), repo = repository(db); await repo.execute(command("same"));
  await rejects(() => repo.execute(command("same", { start: "2026-11-16T20:20:00Z" })), "EVENT_CONFLICT");
  await rejects(() => repo.execute(command("same", { ticketId: "2" })), "EVENT_CONFLICT");
  const calls = db.calls.filter(c => c.connection === 1);
  assert.ok(calls.findIndex(c => c.sql.includes("c2:receipt")) < calls.findIndex(c => c.sql.includes("c2:authorize")));
});

await test("Reintento viejo tras dos reprogramaciones y cancelación devuelve snapshot original", async () => {
  const db = fakeDatabase(), repo = repository(db);
  const original = await repo.execute(command("original"));
  await repo.execute(move("move1", original.appointmentId));
  await repo.execute(move("move2", original.appointmentId, { start: "2026-11-16T20:40:00Z" }));
  const stopped = await repo.execute(cancel("cancel", original.appointmentId));
  assert.equal(stopped.status, "CANCELADA");
  assert.deepEqual(await repository(db).findApplied(command("original").eventId, "SYNTHETIC-A"), original);
  assert.deepEqual(await repo.execute(command("original")), original);
  assert.equal(db.snapshot().appointments[0].status, "CANCELADA");
  assert.equal(db.snapshot().receipts.length, 4);
});

await test("Propiedad, colaborador/servicio activos y vínculo cita-ticket", async () => {
  const db = fakeDatabase(), repo = repository(db); const r = await repo.execute(command("book"));
  await rejects(() => repo.execute(cancel("other", r.appointmentId, { collaboratorId: "SYNTHETIC-B" })), "ACCESS_DENIED");
  await rejects(() => repo.execute(cancel("wrong-ticket", r.appointmentId, { ticketId: "2" })), "APPOINTMENT_NOT_FOUND");
  await rejects(() => repo.findApplied(command("book").eventId, "SYNTHETIC-B"), "ACCESS_DENIED");
  db.edit(d => { d.active["SYNTHETIC-A"] = false; });
  await rejects(() => repo.execute(command("book")), "ACCESS_DENIED");
  db.edit(d => { d.active["SYNTHETIC-A"] = true; d.service = false; });
  await rejects(() => repo.findAppointment(r.appointmentId, "1", "SYNTHETIC-A"), "ACCESS_DENIED");
});

await test("Dos conexiones simuladas: solapamiento entre modalidades y bloques adyacentes", async () => {
  const db = fakeDatabase();
  const raced = await Promise.allSettled([
    repository(db).execute(command("a")),
    repository(db).execute(command("b", { ticketId: "2", modality: "REMOTA" }))
  ]);
  assert.equal(raced.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(raced.find(r => r.status === "rejected").reason.code, "SLOT_UNAVAILABLE");
  await repository(db).execute(command("adjacent", { ticketId: "2", start: "2026-11-16T20:20:00Z" }));
  assert.equal(db.snapshot().appointments.length, 2);
});

await test("Ocupación parcialmente solapada, bloqueos parciales y cambio de disponibilidad", async () => {
  const db = fakeDatabase(), repo = repository(db);
  db.edit(d => d.appointments.push({ id: "90", ticketId: "4", start: "2026-11-16T19:50:00Z", end: "2026-11-16T20:10:00Z", modality: "REMOTA", status: "PROGRAMADA" }));
  await rejects(() => repo.execute(command("partial")), "SLOT_UNAVAILABLE");
  db.edit(d => { d.appointments = []; d.blocks = [{ date: "2026-11-16", begin: "14:10", end: "14:15" }]; });
  await rejects(() => repo.execute(command("blocked")), "SLOT_UNAVAILABLE");
  db.edit(d => { d.blocks = []; });
  assert.ok((await repo.listAvailable({ ticketId: "1", collaboratorId: "SYNTHETIC-A", date: "2026-11-16", modality: "PRESENCIAL" })).includes(start));
  db.edit(d => { d.hours = []; });
  await rejects(() => repo.execute(command("changed")), "NO_CONFIGURED_HOURS");
  assert.equal(db.snapshot().receipts.length, 0);
});

await test("120:00 válido; 119:59 inválido; reloj posterior a espera y guardia final SQL", async () => {
  const db = fakeDatabase(); await repository(db).execute(command("exact"));
  for (const kind of ["now", "lock", "write"]) {
    const d = fakeDatabase();
    if (kind === "now") d.now += 1000;
    if (kind === "lock") d.advanceAtLock = 1000;
    if (kind === "write") d.advanceAtWrite = 1000;
    await rejects(() => repository(d).execute(command(kind)), kind === "write" ? "NOTICE_TOO_SHORT" : "SLOT_UNAVAILABLE");
    assert.equal(d.snapshot().appointments.length, 0); assert.equal(d.snapshot().receipts.length, 0);
  }
});

await test("ISO/zona México: diez bloques, cierre 17:30, fin de semana y grilla exacta", async () => {
  const db = fakeDatabase(), repo = repository(db);
  const slots = await repo.listAvailable({ ticketId: "1", collaboratorId: "SYNTHETIC-A", date: "2026-11-16", modality: "PRESENCIAL" });
  assert.equal(slots.length, 10); assert.equal(slots.at(-1), "2026-11-16T23:00:00.000Z");
  for (const value of ["2026-11-16T23:20:00Z", "2026-11-16T20:10:00Z", "2026-11-21T20:00:00Z", "2026-11-22T20:00:00Z"]) {
    await rejects(() => repo.execute(command(value, { start: value })), "SLOT_UNAVAILABLE");
  }
});

await test("Reprogramación fallida conserva original y rollback revierte cambio sin recibo", async () => {
  const db = fakeDatabase(), repo = repository(db), r = await repo.execute(command("original"));
  await repo.execute(command("occupied", { ticketId: "2", start: "2026-11-16T20:20:00Z" }));
  await rejects(() => repo.execute(move("bad", r.appointmentId)), "SLOT_UNAVAILABLE");
  assert.equal(db.snapshot().appointments[0].start, start);
  db.fault = "receipt";
  await rejects(() => repo.execute(move("rollback", r.appointmentId, { start: "2026-11-16T20:40:00Z" })), "DATABASE_UNAVAILABLE");
  assert.equal(db.snapshot().appointments[0].start, start);
  assert.equal(db.snapshot().receipts.length, 2);
});

await test("Cancelación expresa idempotente, no cierra ni resuelve ticket; CANCELADA permite cierre explícito", async () => {
  const db = fakeDatabase(), repo = repository(db), r = await repo.execute(command("original"));
  const tickets = createNeonTicketRepository(db.pool);
  await rejects(() => tickets.closeWithoutAppointment("1", "SYNTHETIC-A"), "INVALID_TRANSITION");
  const stopped = await repo.execute(cancel("cancel", r.appointmentId));
  assert.deepEqual(await repo.execute(cancel("cancel", r.appointmentId)), stopped);
  assert.equal(db.snapshot().tickets[0].status, "pendiente de cita");
  const closed = await tickets.closeWithoutAppointment("1", "SYNTHETIC-A");
  assert.equal(closed.status, "cerrado sin cita"); assert.equal(closed.resolvedAt, null);
  assert.ok(closed.closedAt); assert.equal(db.snapshot().appointments[0].status, "CANCELADA");
  assert.deepEqual(await repo.execute(command("original")), r);
});

await test("REALIZADA/NO_ASISTIO son históricos: no se modifican ni resuelven automáticamente", async () => {
  for (const status of ["REALIZADA", "NO_ASISTIO"]) {
    const db = fakeDatabase(), repo = repository(db), r = await repo.execute(command("book"));
    db.edit(d => { d.appointments[0].status = status; });
    await rejects(() => repo.execute(cancel("historical", r.appointmentId)), "INVALID_TRANSITION");
    await rejects(() => repo.execute(move("historical-move", r.appointmentId)), "INVALID_TRANSITION");
    assert.equal((await repo.findAppointment(r.appointmentId, "1", "SYNTHETIC-A")).status, status);
    assert.equal(db.snapshot().tickets[0].resolvedAt, null);
  }
});

await test("Evento no puede crear ticket y cita: ambos sentidos y carrera simulada", async () => {
  const db = fakeDatabase(), repo = repository(db), tickets = createNeonTicketRepository(db.pool);
  await rejects(() => repo.execute(command("unused", { eventId: "wamid.SYNTHETIC-ticket-1" })), "EVENT_CONFLICT");
  const r = await repo.execute(command("applied"));
  await rejects(() => tickets.createConfirmed({ collaboratorId: "SYNTHETIC-A", serviceId: "1", description: "Ficticio", summary: "Ficticio", confirmationId: command("applied").eventId }), "EVENT_CONFLICT");
  const d = fakeDatabase(), eventId = "wamid.SYNTHETIC-race";
  const attempts = await Promise.allSettled([
    repository(d).execute(command("race", { eventId })),
    createNeonTicketRepository(d.pool).createConfirmed({ collaboratorId: "SYNTHETIC-A", serviceId: "1", description: "Ficticio", summary: "Ficticio", confirmationId: eventId })
  ]);
  assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(attempts.find(r => r.status === "rejected").reason.code, "EVENT_CONFLICT");
  assert.equal(r.ticketId, "1");
});

await test("Fallo antes de recibo, antes de COMMIT y pérdida de respuesta tras COMMIT", async () => {
  for (const fault of ["receipt", "before-commit", "after-commit"]) {
    const db = fakeDatabase(); db.fault = fault;
    await rejects(() => repository(db).execute(command(fault)), fault === "receipt" ? "DATABASE_UNAVAILABLE" : "COMMIT_OUTCOME_UNKNOWN");
    const recovered = await repository(db).findApplied(command(fault).eventId, "SYNTHETIC-A");
    assert.equal(Boolean(recovered), fault === "after-commit");
    const retried = await repository(db).execute(command(fault));
    if (recovered) assert.deepEqual(retried, recovered);
    assert.equal(db.snapshot().appointments.length, 1); assert.equal(db.snapshot().receipts.length, 1);
  }
});

await test("Rechazos no producen recibo; reintento revalida disponibilidad y contexto no es persistencia", async () => {
  const db = fakeDatabase(), repo = repository(db);
  db.edit(d => { d.blocks = [{ date: "2026-11-16", begin: "14:00", end: "14:20" }]; });
  await rejects(() => repo.execute(command("retry")), "SLOT_UNAVAILABLE");
  assert.equal(await repo.findApplied(command("retry").eventId, "SYNTHETIC-A"), null);
  db.edit(d => { d.blocks = []; }); await repository(db).execute(command("retry"));
  db.now += 7_200_000; // Volatile draft could expire; committed model remains.
  assert.ok(await repository(db).findApplied(command("retry").eventId, "SYNTHETIC-A"));
  assert.equal(db.snapshot().receipts.length, 1);
});

await test("Recibo corrupto falla sin admitir JSON extra o falsa vinculación", async () => {
  const db = fakeDatabase(), repo = repository(db); await repo.execute(command("valid"));
  db.edit(d => { d.receipts[0].result.extra = "not allowed"; });
  await rejects(() => repo.findApplied(command("valid").eventId, "SYNTHETIC-A"), "INVALID_RECEIPT");
});

await test("Cancelación/reprogramación conservan margen original, identidad y unicidad por ticket", async () => {
  const db = fakeDatabase(), repo = repository(db), r = await repo.execute(command("book"));
  await rejects(() => repo.execute(command("second", { start: "2026-11-16T20:20:00Z" })), "ALREADY_BOOKED");
  db.now += 1000;
  await rejects(() => repo.execute(cancel("late", r.appointmentId)), "NOTICE_TOO_SHORT");
  await rejects(() => repo.execute(move("late-move", r.appointmentId)), "NOTICE_TOO_SHORT");
  assert.equal(db.snapshot().appointments[0].start, start);
  assert.equal(db.snapshot().receipts.length, 1);
});

await test("Errores SQL de exclusión/unicidad/timeout se distinguen sin revelar parámetros", async () => {
  for (const code of ["23505", "23P01", "55P03", "57014"]) {
    const db = fakeDatabase(); db.writeError = code;
    await rejects(() => repository(db).execute(command("error")),
      ["23505", "23P01"].includes(code) ? "PERSISTENCE_CONFLICT" : "PERSISTENCE_BUSY");
    assert.equal(db.calls.at(-1).sql, "ROLLBACK");
    assert.equal(db.snapshot().receipts.length, 0);
  }
});

await test("Calendario inválido o ambiguo falla explícitamente, sin fallback silencioso", async () => {
  for (const mutate of [
    d => { d.hours[0].begin = null; },
    d => { d.hours.push({ ...d.hours[0] }); },
    d => { d.hours[0].day = 0; },
    d => { d.blocks = [{ date: "2026-11-16", begin: "15:00", end: null }]; }
  ]) {
    const db = fakeDatabase(); db.edit(mutate);
    await rejects(() => repository(db).execute(command("invalid-calendar")), "INVALID_CALENDAR");
  }
});

await test("Reserva tras espera no mantiene Gemini dentro de bloqueo; eventos y datos se parametrizan", async () => {
  const db = fakeDatabase(), repo = repository(db); await repo.execute(command("params"));
  for (const c of db.calls) {
    assert.ok(!c.sql.includes(command("params").eventId));
    assert.ok(!c.sql.includes("SYNTHETIC-A"));
    assert.ok(!/gemini|generateContent/i.test(c.sql));
  }
  const times = db.calls.find(c => c.sql.includes("c2:book"));
  assert.match(times.sql, /clock_timestamp\(\)\+interval '120 minutes'/);
  assert.match(db.calls.find(c => c.sql.includes("c2:authorize")).sql, /FOR UPDATE OF t FOR SHARE OF c,s/);
  const row = db.snapshot().receipts[0];
  assert.equal(Object.keys(row.result).length, 8);
  assert.ok(!JSON.stringify(row).includes("SYNTHETIC-A"));
});

console.log(`02-C2: ${groups} grupos PASS; cliente SQL simulado, sin acceso ni escrituras Neon.`);
