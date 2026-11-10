import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPayrollReception, INACTIVITY_MS } from "../src/lib/server/payroll-reception.ts";
import { createMemoryTicketRepository, createNeonTicketRepository } from "../src/lib/server/payroll-tickets.ts";
import { parseFriday } from "../src/lib/server/payroll-dates.ts";
import { extractIncomingTextMessages } from "../src/lib/server/whatsapp-message-processing.js";
import { processIncomingConversationEvent } from "../src/lib/server/whatsapp-conversation.js";
import { dependencies, phone, prepare, services } from "./fixtures/payroll.mjs";

let groups = 0;
async function test(label, run) {
  await run();
  groups++;
  console.log(`${label}: PASS.`);
}

await test("Identidad activa, inactiva, ausente y ambigua; cero tickets antes de confirmar", async () => {
  const repo = createMemoryTicketRepository();
  const manager = createPayrollReception(dependencies(), repo);
  for (const suffix of ["2", "3", "4"]) {
    assert.equal((await manager.handleMessage(`00000000000000${suffix}`, "hola")).action, "access_denied");
  }
  const menu = await manager.handleMessage(phone, "hola", "greeting");
  assert.match(menu.reply, /1\. Nómina.*\n2\. Políticas.*\n3\. Tu Voz/s);
  await manager.handleMessage(phone, "1", "payroll-menu");
  assert.equal(repo.snapshot().length, 0);
});

await test("Los ocho servicios numéricos, explicación, viernes y confirmación explícita", async () => {
  for (let option = 1; option <= 8; option++) {
    const repo = createMemoryTicketRepository();
    const manager = createPayrollReception(dependencies(), repo);
    await manager.handleMessage(phone, "1");
    const selected = await manager.handleMessage(phone, String(option));
    assert.equal(selected.action, "payroll_friday");
    await manager.handleMessage(phone, "06/11/2026");
    const summary = await manager.handleMessage(phone, "El concepto no aparece en mi pago.");
    assert.equal(summary.action, "payroll_summary");
    assert.match(summary.reply, /06\/11\/2026/);
    assert.equal(repo.snapshot().length, 0);
    assert.equal((await manager.handleMessage(phone, "tal vez", "unclear")).action, "payroll_confirm_required");
    assert.equal((await manager.handleMessage(phone, "confirmo")).action, "payroll_missing_confirmation_id");
    assert.equal(repo.snapshot().length, 0);
    const result = await manager.handleMessage(phone, "confirmo", `confirm-${option}`);
    assert.equal(result.action, "payroll_ticket_created");
    assert.equal(repo.snapshot()[0].serviceId, String(option));
    assert.equal(repo.snapshot()[0].resolvedAt, null);
    assert.match(result.reply, /no se reserva ninguna cita/);
    assert.equal(result.ticket.persistence, "simulation");
  }
});

await test("Entrada natural reutiliza relato y fecha; pago y requisitos de premios siguen separados", async () => {
  const repo = createMemoryTicketRepository();
  const manager = createPayrollReception(dependencies(), repo);
  const result = await manager.handleMessage(phone, "No recibí el pago semanal del 06/11/2026.", "direct");
  assert.equal(result.action, "payroll_summary");
  assert.doesNotMatch(result.reply, /Cuéntame/);
  const policy = createPayrollReception(dependencies(), createMemoryTicketRepository());
  const requirements = await policy.handleMessage(phone, "¿Cuáles son los requisitos del premio?");
  assert.match(requirements.reply, /Políticas y procedimientos/);
  assert.equal(requirements.ticket, undefined);
  const award = createPayrollReception(dependencies(), createMemoryTicketRepository());
  assert.equal((await award.handleMessage(phone, "No me pagaron el premio.")).action, "payroll_friday");
});

await test("Viernes absoluto, relativo, fecha imposible, día distinto y año ambiguo", async () => {
  const now = Date.parse("2026-11-10T18:00:00Z");
  assert.deepEqual(parseFriday("viernes 6 de noviembre de 2026", now), { kind: "explicit", date: "2026-11-06" });
  for (const text of ["31/02/2026", "10/11/2026"]) assert.equal(parseFriday(text, now).kind, "invalid");
  assert.equal(parseFriday("viernes 6 de noviembre", now).kind, "missing");
  assert.equal(parseFriday("06/11/2026 o 13/11/2026", now).kind, "ambiguous");
  assert.deepEqual(parseFriday("viernes pasado", now), { kind: "candidate", date: "2026-11-06" });
  assert.deepEqual(parseFriday("esta semana", now), { kind: "candidate", date: "2026-11-13" });
  const repo = createMemoryTicketRepository();
  const manager = createPayrollReception(dependencies(), repo, { now: () => now });
  await manager.handleMessage(phone, "Me falta el pago semanal del viernes pasado.");
  assert.equal((await manager.handleMessage(phone, "no")).action, "payroll_friday");
  assert.equal((await manager.handleMessage(phone, "esta semana")).action, "payroll_friday_candidate");
  const result = await manager.handleMessage(phone, "sí");
  assert.equal(result.action, "payroll_summary");
  assert.match(result.reply, /13\/11\/2026/);
  assert.equal(repo.snapshot().length, 0);
});

await test("Correcciones antes de confirmar; cancelar/menú/regresar nunca registran ni resuelven", async () => {
  const repo = createMemoryTicketRepository();
  const manager = createPayrollReception(dependencies(), repo);
  await prepare(manager);
  await manager.handleMessage(phone, "corregir");
  await manager.handleMessage(phone, "viernes");
  assert.match((await manager.handleMessage(phone, "13/11/2026")).reply, /13\/11\/2026/);
  await manager.handleMessage(phone, "no");
  await manager.handleMessage(phone, "explicación");
  await manager.handleMessage(phone, "El pago aparece incompleto, requiero aclararlo.");
  await manager.handleMessage(phone, "corregir");
  await manager.handleMessage(phone, "tema");
  assert.equal((await manager.handleMessage(phone, "2")).action, "payroll_summary");
  for (const command of ["cancelar", "menú principal", "regresar"]) {
    const fresh = createPayrollReception(dependencies(), repo);
    await prepare(fresh);
    await fresh.handleMessage(phone, command);
  }
  assert.equal(repo.snapshot().length, 0);
});

await test("ID inventado/inactivo o cambio de catálogo no se registra; proveedor falla sin efectos", async () => {
  const repo = createMemoryTicketRepository();
  const deps = dependencies();
  const manager = createPayrollReception(deps, repo);
  await prepare(manager);
  deps.listActiveServices = async () => services.filter(s => s.idServicio !== "1");
  await assert.rejects(manager.handleMessage(phone, "confirmo", "inactive"), { code: "PAYROLL_CATALOG_UNAVAILABLE" });
  deps.listActiveServices = async () => services.map(service =>
    service.idServicio === "1" ? { ...service, idServicio: "16" } : service);
  assert.equal((await manager.handleMessage(phone, "confirmo", "removed")).action, "payroll_topic");
  const fakeId = createPayrollReception({
    ...dependencies(), classifyService: async () => ({ serviceId: "invented", classification: "clasificado" })
  }, repo);
  assert.equal((await fakeId.handleMessage(phone, "Me falta algo en el pago.")).action, "clarify_category");
  await fakeId.handleMessage(phone, "1");
  assert.equal((await fakeId.handleMessage(phone, "Mi concepto no aparece.")).action, "payroll_topic");
  const broken = createPayrollReception({
    ...dependencies(), classifyService: async () => { throw new Error("SYNTHETIC_PROVIDER_FAILURE"); }
  }, repo);
  await assert.rejects(broken.handleMessage(phone, "Me falta el pago semanal.", "retryable"));
  assert.equal(repo.snapshot().length, 0);
});

await test("Negativa expresa cierra sin resolver; sí/luego/silencio no reservan ni cierran", async () => {
  const repo = createMemoryTicketRepository();
  const manager = createPayrollReception(dependencies(), repo);
  await prepare(manager);
  const ticket = await manager.handleMessage(phone, "confirmo", "confirm-close");
  for (const text of ["sí", "luego", "no sé", "ahora no"]) {
    assert.equal((await manager.handleMessage(phone, text)).action, "payroll_no_booking");
    assert.equal(repo.snapshot()[0].status, "pendiente de cita");
  }
  const closed = await manager.handleMessage(phone, "No quiero agendar", "explicit-no");
  assert.equal(closed.ticket.folio, ticket.ticket.folio);
  assert.equal(repo.snapshot()[0].status, "cerrado sin cita");
  assert.equal(repo.snapshot()[0].resolvedAt, null);
  assert.ok(repo.snapshot()[0].closedAt);
  const before = repo.snapshot();
  await manager.handleMessage(phone, "No quiero agendar", "explicit-no");
  await manager.handleMessage(phone, "cancelar");
  assert.deepEqual(repo.snapshot(), before);
});

await test("Caducidad exacta: 119m59s conserva; 120m caduca sin cerrar ni borrar ticket", async () => {
  let clock = Date.parse("2026-11-10T18:00:00Z");
  const repo = createMemoryTicketRepository();
  const manager = createPayrollReception(dependencies(), repo, { now: () => clock });
  await prepare(manager);
  clock += INACTIVITY_MS - 1000;
  assert.equal((await manager.handleMessage(phone, "confirmo", "edge")).action, "payroll_ticket_created");
  const before = repo.snapshot();
  clock += INACTIVITY_MS;
  assert.equal((await manager.handleMessage(phone, "hola", "expired")).action, "welcome");
  await manager.handleMessage(phone, "no", "not-refusal");
  assert.deepEqual(repo.snapshot(), before);
  const draft = createPayrollReception(dependencies(), repo, { now: () => clock });
  await prepare(draft, "-expiry");
  clock += INACTIVITY_MS;
  assert.notEqual((await draft.handleMessage(phone, "confirmo", "late")).action, "payroll_ticket_created");
  assert.equal(repo.snapshot().length, 1);
});

await test("Reintentos, concurrencia del mismo evento y reinicio de motor conservan ticket/folio", async () => {
  const repo = createMemoryTicketRepository();
  const manager = createPayrollReception(dependencies(), repo);
  await prepare(manager);
  const results = await Promise.all(Array.from({ length: 5 }, () =>
    manager.handleMessage(phone, "confirmo", "concurrent")));
  assert.equal(new Set(results.map(r => r.ticket.folio)).size, 1);
  assert.equal(repo.snapshot().length, 1);
  await manager.handleMessage(phone, "sí", "different-confirmation");
  assert.equal(repo.snapshot().length, 1);
  const restarted = createPayrollReception(dependencies(), repo);
  const replay = await restarted.handleMessage(phone, "confirmo", "concurrent");
  assert.equal(replay.action, "payroll_ticket_replayed");
  assert.equal(replay.ticket.folio, results[0].ticket.folio);
  const otherProcess = createPayrollReception(dependencies(), repo);
  const duplicates = await Promise.all([restarted, otherProcess].map(m =>
    m.handleMessage(phone, "confirmo", "concurrent")));
  assert.equal(new Set(duplicates.map(r=>r.ticket.folio)).size, 1);
  const manager2 = createPayrollReception(dependencies(), repo);
  const first = await manager2.handleMessage(phone, "1", "same-menu");
  assert.equal(first.action, "payroll_topic");
  assert.equal((await manager2.handleMessage(phone, "1", "same-menu")).action, "duplicate_ignored");
  const racingRepo = createMemoryTicketRepository();
  const racers = [createPayrollReception(dependencies(), racingRepo), createPayrollReception(dependencies(), racingRepo)];
  await Promise.all(racers.map((m, index) => prepare(m, `-${index}`)));
  const raced = await Promise.all(racers.map(m => m.handleMessage(phone, "confirmo", "same-new-key")));
  assert.equal(racingRepo.snapshot().length, 1);
  assert.equal(raced[0].ticket.folio, raced[1].ticket.folio);
});

await test("Error de escritura reintentable y confirmación con respuesta perdida no duplican", async () => {
  const durable = createMemoryTicketRepository();
  let fail = true;
  const repository = {
    ...durable,
    createConfirmed: async input => {
      const ticket = await durable.createConfirmed(input);
      if (fail) { fail = false; throw new Error("SYNTHETIC_LOST_RESPONSE"); }
      return ticket;
    }
  };
  const manager = createPayrollReception(dependencies(), repository);
  await prepare(manager);
  await assert.rejects(manager.handleMessage(phone, "confirmo", "lost-response"));
  assert.equal(durable.snapshot().length, 1);
  const replay = await manager.handleMessage(phone, "confirmo", "lost-response");
  assert.equal(replay.action, "payroll_ticket_replayed");
  assert.equal(durable.snapshot().length, 1);
  assert.equal((await manager.handleMessage(phone, "no quiero agendar", "after-recovery")).action,
    "payroll_closed_without_appointment");
});

await test("Reasignación del teléfono no reutiliza datos de otro colaborador; reintentos no renuevan caducidad", async () => {
  const deps = dependencies();
  const repo = createMemoryTicketRepository();
  let clock = Date.parse("2026-11-10T18:00:00Z");
  const manager = createPayrollReception(deps, repo, { now: () => clock });
  await prepare(manager);
  clock += INACTIVITY_MS - 1;
  assert.equal((await manager.handleMessage(phone, "06/11/2026", "date")).action, "duplicate_ignored");
  clock += 1;
  assert.notEqual((await manager.handleMessage(phone, "confirmo", "expired-after-retry")).action, "payroll_ticket_created");
  await manager.handleMessage(phone, "menú principal");
  await prepare(manager, "-other-owner");
  deps.lookupIdentity = async () => ({ status: "active", id: "SYNTHETIC-OTHER" });
  assert.notEqual((await manager.handleMessage(phone, "confirmo", "reassigned")).action, "payroll_ticket_created");
  assert.equal(repo.snapshot().length, 0);
});

await test("Reinicio de DOS procesos Node con base ficticia persistida fuera del repositorio", async () => {
  const directory = await mkdtemp(join(tmpdir(), "catarina-payroll-"));
  try {
    const file = join(directory, "fake-database.json");
    const run = phase => JSON.parse(execFileSync(process.execPath,
      ["scripts/fixtures/payroll-restart.mjs", file, phase], { encoding: "utf8", env: {} }));
    const created = run("create");
    const replay = run("replay");
    assert.equal(created.count, 1);
    assert.equal(replay.count, 1);
    assert.equal(created.folio, replay.folio);
    assert.equal(replay.action, "payroll_ticket_replayed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("El ID técnico pasa del webhook al motor sin alterar las pruebas antiguas", async () => {
  const event = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    messages: [{ id: "wamid.synthetic", from: phone, type: "text", text: { body: "hola" } }]
  } }] }] };
  assert.equal(extractIncomingTextMessages(event)[0].messageId, "wamid.synthetic");
  let key;
  await processIncomingConversationEvent(event, { handleMessage: async (_phone, _text, messageId) => {
    key = messageId;
    return { collaboratorStatus: "active", action: "fixture", reply: "", classification: null };
  } });
  assert.equal(key, "wamid.synthetic");
});

await test("Políticas y Tu Voz conservan navegación sin nuevos registros ni agenda", async () => {
  const repo = createMemoryTicketRepository();
  const manager = createPayrollReception(dependencies(), repo);
  await manager.handleMessage(phone, "hola");
  assert.match((await manager.handleMessage(phone, "3")).reply, /Quejas y denuncias/);
  assert.match((await manager.handleMessage(phone, "2")).reply, /Ideas y mejoras/);
  await manager.handleMessage(phone, "menú principal");
  assert.match((await manager.handleMessage(phone, "2")).reply, /Políticas y procedimientos/);
  await manager.handleMessage(phone, "Quiero saber de vacaciones.");
  assert.equal(repo.snapshot().length, 0);
});

await test("Adaptador SQL simulado: transacción, parámetros, conflicto único, BIGINT y rollback seguro", async () => {
  const calls = [];
  const row = {
    id: "9007199254740993", collaboratorId: "SYNTHETIC", serviceId: "1",
    description: "Explicación ficticia", summary: "Resumen ficticio", status: "pendiente de cita",
    closedAt: null, resolvedAt: null, outcome: null, confirmationId: "fake-confirm"
  };
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM public.colaboradores") || sql.includes("FROM public.servicios")) return { rows: [{}] };
      if (sql.startsWith("INSERT")) return { rows: [] }; // Simulates UNIQUE losing a race.
      if (sql.startsWith("SELECT") && sql.includes("FROM public.tickets")) return { rows: [row] };
      return { rows: [] };
    },
    release: () => calls.push({ sql: "RELEASE" })
  };
  const repo = createNeonTicketRepository({ connect: async () => client });
  const result = await repo.createConfirmed({
    collaboratorId: "SYNTHETIC", serviceId: "1", description: row.description,
    summary: row.summary, confirmationId: row.confirmationId
  });
  assert.equal(result.folio, "NOM-9007199254740993");
  assert.ok(calls.some(c=>c.sql.includes("ON CONFLICT (id_mensaje_confirmacion) DO NOTHING")));
  const insertion = calls.find(c=>c.sql.startsWith("INSERT"));
  assert.equal(insertion.params[4], row.confirmationId);
  assert.ok(!insertion.sql.includes(row.description));
  assert.equal(calls.at(-2).sql, "COMMIT");
  const bad = createNeonTicketRepository({ connect: async () => ({
    query: async (sql) => { if(sql === "BEGIN" || sql === "ROLLBACK") return {rows:[]}; throw new Error("PRIVATE_SQL_DETAIL"); },
    release() {}
  }) });
  await assert.rejects(bad.findByConfirmation("fake", "SYNTHETIC"), error =>
    error.code === "DATABASE_UNAVAILABLE" && !error.message.includes("PRIVATE"));
  const noAccess = createNeonTicketRepository({ connect: async () => ({
    query: async () => ({ rows: [] }), release() {}
  }) });
  await assert.rejects(noAccess.createConfirmed({
    collaboratorId: "SYNTHETIC", serviceId: "1", description: "Ficticio",
    summary: "Ficticio", confirmationId: "denied"
  }), { code: "INACTIVE_IDENTITY_OR_SERVICE" });
  const closeCalls = [];
  const closedRow = { ...row, status: "cerrado sin cita", closedAt: "2026-11-10", resolvedAt: null };
  const closeRepo = createNeonTicketRepository({ connect: async () => ({
    query: async (sql, params) => {
      closeCalls.push({ sql, params });
      return { rows: sql.startsWith("UPDATE") ? [closedRow] : [] };
    }, release() {}
  }) });
  assert.equal((await closeRepo.closeWithoutAppointment(row.id, row.collaboratorId)).resolvedAt, null);
  const update = closeCalls.find(call => call.sql.startsWith("UPDATE"));
  assert.match(update.sql, /resuelto_en IS NULL/);
  assert.match(update.sql, /NOT EXISTS \(SELECT 1 FROM public.citas/);
  assert.ok(!/resuelto_en\s*=/.test(update.sql));
});

console.log(`02-A: ${groups} grupos PASS; solo repositorios simulados, sin escrituras Neon ni envíos WhatsApp.`);
