import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { createNeonTicketRepository, CLOSED_OUTCOME } from "../src/lib/server/payroll-tickets.ts";

// Opt-in only. Default execution inspects without writing.
// No connection strings, row contents, synthetic identifiers or pg errors are logged.
const authorized = process.argv.includes("--rollback-authorized");
const tables = [
  "bloqueos_agenda", "citas", "colaboradores", "consultas", "denuncias",
  "encuestas", "fuentes", "horarios_atencion", "seguimientos_denuncia",
  "servicios", "tickets"
];
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  max: 1
});
let client;
let outerOpen = false;
let rollbackVerified = false;
let stage = "connection";

async function snapshot() {
  const result = {};
  // Identifiers are exclusively this fixed allowlist, never parameters or input.
  for (const table of tables) {
    const { rows: [row] } = await client.query(`
      SELECT count(*)::int AS count,
        md5(coalesce(string_agg(fingerprint, '' ORDER BY fingerprint), '')) AS fingerprint
      FROM (SELECT md5(to_jsonb(t)::text) AS fingerprint FROM public.${table} t) s`);
    result[table] = row;
  }
  return result;
}

function counts(snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([table, row]) => [table, row.count]));
}

async function inspect() {
  const { rows: found } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  assert.deepEqual(found.map((row) => row.table_name), [...tables].sort());
  const { rows: columns } = await client.query(`
    SELECT table_name,column_name,data_type,is_nullable,is_identity,column_default
    FROM information_schema.columns WHERE table_schema='public'
    ORDER BY table_name,ordinal_position`);
  const column = columns.find((row) => row.table_name === "tickets"
    && row.column_name === "id_mensaje_confirmacion");
  assert.equal(column?.data_type, "text");
  assert.equal(column?.is_nullable, "YES");
  const { rows: constraints } = await client.query(`
    SELECT conrelid::regclass::text AS source, confrelid::regclass::text AS target,
      contype, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE connamespace='public'::regnamespace OR
      confrelid IN ('public.colaboradores'::regclass,'public.servicios'::regclass,'public.tickets'::regclass)
    ORDER BY conrelid,oid`);
  assert(constraints.some((row) => row.source === "tickets" && row.contype === "u"
    && row.definition === "UNIQUE (id_mensaje_confirmacion)"));
  const dependencies = constraints.filter((row) => row.contype === "f");
  assert(dependencies.every((row) => tables.includes(row.source)
    && tables.includes(row.target)), "Unreviewed dependency");
  const { rows: [guards] } = await client.query(`
    SELECT
      (SELECT count(*)::int FROM pg_trigger
        WHERE tgrelid IN ('public.colaboradores'::regclass,'public.servicios'::regclass,'public.tickets'::regclass)
          AND NOT tgisinternal) AS triggers,
      (SELECT count(*)::int FROM pg_class
        WHERE oid IN ('public.colaboradores'::regclass,'public.servicios'::regclass,'public.tickets'::regclass)
          AND (relrowsecurity OR relforcerowsecurity)) AS rls`);
  assert.equal(guards.triggers, 0);
  assert.equal(guards.rls, 0);
  const { rows: catalog } = await client.query(`
    SELECT categoria,count(*)::int AS count FROM public.servicios
    WHERE activo IS TRUE GROUP BY categoria ORDER BY categoria`);
  assert.deepEqual(catalog, [
    { categoria: "Nómina y prestaciones", count: 8 },
    { categoria: "Políticas y procedimientos", count: 5 },
    { categoria: "Tu Voz en Trainmex", count: 2 }
  ]);
  return JSON.stringify({ columns, constraints, guards });
}

try {
  assert(process.env.DATABASE_URL, "Missing required Secret");
  client = await pool.connect();
  await client.query("BEGIN READ ONLY");
  const schema = await inspect();
  const baseline = await snapshot();
  await client.query("ROLLBACK");
  console.log("Preflight: PASS; 11 tables, reviewed foreign keys, no custom triggers/RLS; catalog 15 (8/5/2).");
  console.log("Initial counts:", JSON.stringify(counts(baseline)));
  if (!authorized) {
    console.log("READ ONLY: PASS. Writes NOT EXECUTED; explicit --rollback-authorized required.");
  } else {
    stage = "isolation";
    await client.query("BEGIN");
    outerOpen = true;
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
    // Fail rather than wait for concurrent writers. Readers remain allowed.
    // Lock all reviewed tables to make baseline/final comparison unambiguous.
    await client.query(`LOCK TABLE ${tables.map((table) => `public.${table}`).join(", ")}
      IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    assert.equal(await inspect(), schema);
    assert.deepEqual(await snapshot(), baseline);

    const owner = `SYNTHETIC-02A-${randomUUID()}`;
    const confirmation = `SYNTHETIC-CONFIRMATION-${randomUUID()}`;
    const service = String(-BigInt(`0x${randomBytes(6).toString("hex")}`) - 1n);
    const input = {
      collaboratorId: owner, serviceId: service, confirmationId: confirmation,
      description: "PRUEBA SINTETICA 02-A: sin persona ni pago real.",
      summary: "PRUEBA SINTETICA 02-A: resumen ficticio confirmado."
    };

    async function guardWrites(expectedTickets, fixturesPresent) {
      assert(outerOpen, "Outer rollback scope missing");
      const { rows: [row] } = await client.query(`
        SELECT
          (SELECT count(*)::int FROM public.colaboradores WHERE id_colaborador=$1) AS owners,
          (SELECT count(*)::int FROM public.servicios WHERE id_servicio=$2) AS services,
          (SELECT count(*)::int FROM public.tickets
            WHERE id_colaborador=$1 OR id_servicio=$2 OR id_mensaje_confirmacion=$3) AS tickets,
          (SELECT count(*)::int FROM public.tickets
            WHERE id_colaborador=$1 AND id_servicio=$2 AND id_mensaje_confirmacion=$3) AS exact,
          (SELECT count(*)::int FROM public.citas WHERE id_ticket IN
            (SELECT id_ticket FROM public.tickets WHERE id_mensaje_confirmacion=$3)) AS appointments`,
      [owner, service, confirmation]);
      assert.deepEqual(row, {
        owners: fixturesPresent ? 1 : 0, services: fixturesPresent ? 1 : 0,
        tickets: expectedTickets, exact: expectedTickets, appointments: 0
      });
    }

    stage = "synthetic fixtures";
    await guardWrites(0, false);
    await client.query(`INSERT INTO public.colaboradores
      (id_colaborador,nombre,whatsapp,activo) VALUES ($1,$2,NULL,TRUE)`,
    [owner, "PRUEBA SINTETICA 02-A - NO ES PERSONA"]);
    // Still inside outer rollback; no real service or worker used as a fixture.
    assert.equal((await client.query(
      "SELECT count(*)::int AS n FROM public.servicios WHERE id_servicio=$1", [service]
    )).rows[0].n, 0);
    await client.query(`INSERT INTO public.servicios
      (id_servicio,categoria,subcategoria,activo) VALUES ($1,$2,$3,TRUE)`,
    [service, "Nómina y prestaciones", "PRUEBA SINTETICA 02-A - NO ES SERVICIO OPERATIVO"]);
    await guardWrites(0, true);
    console.log("Fixtures: PASS; 1 synthetic collaborator (NULL phone), 1 synthetic service; uncommitted.");

    // Test-only transaction harness: the actual adapter SQL runs on Neon.
    // Adapter BEGIN/COMMIT become savepoint boundaries; no outer COMMIT exists.
    // Therefore tests prove real SQL/UNIQUE behavior within one connection,
    // NOT durable commit, restart recovery or cross-connection concurrency.
    let operationOpen = false;
    const scopedPool = {
      async connect() {
        assert(!operationOpen, "Concurrent use of single-transaction harness is prohibited");
        operationOpen = true;
        return {
          async query(sql, params) {
            if (sql === "BEGIN") return client.query("SAVEPOINT adapter_operation");
            if (sql === "COMMIT") return client.query("RELEASE SAVEPOINT adapter_operation");
            if (sql === "ROLLBACK") {
              await client.query("ROLLBACK TO SAVEPOINT adapter_operation");
              return client.query("RELEASE SAVEPOINT adapter_operation");
            }
            return client.query(sql, params);
          },
          release() { operationOpen = false; }
        };
      }
    };
    const repository = createNeonTicketRepository(scopedPool);
    stage = "insert";
    await guardWrites(0, true);
    const created = await repository.createConfirmed(input);
    assert.equal(created.folio, `NOM-${created.id}`);
    assert.equal(created.status, "pendiente de cita");
    assert.equal(created.closedAt, null);
    assert.equal(created.resolvedAt, null);
    await guardWrites(1, true);
    console.log("Insert + stable folio + pending/unresolved state: PASS; 1 ticket.");

    stage = "two repeated confirmations";
    for (let i = 0; i < 2; i++) {
      await guardWrites(1, true);
      const repeated = await repository.createConfirmed(input);
      assert.deepEqual(repeated, created);
      await guardWrites(1, true);
    }
    console.log("Two repeated confirmations: PASS; same ticket/folio, count remains 1.");

    stage = "lost response recovery";
    // Discard the original repository/reference and recover using key and owner.
    // This is an uncommitted response-loss simulation, NOT a network failure.
    const recovered = await createNeonTicketRepository(scopedPool)
      .findByConfirmation(confirmation, owner);
    assert.deepEqual(recovered, created);
    console.log("Lost-response lookup with fresh adapter: PASS (same transaction, no restart claim).");

    stage = "explicit refusal";
    await guardWrites(1, true);
    const closed = await repository.closeWithoutAppointment(created.id, owner);
    assert.equal(closed.status, "cerrado sin cita");
    assert(closed.closedAt);
    assert.equal(closed.resolvedAt, null);
    assert.equal(closed.outcome, CLOSED_OUTCOME);
    await guardWrites(1, true);
    const closedAgain = await repository.closeWithoutAppointment(created.id, owner);
    assert.deepEqual(closedAgain, closed);
    console.log("Explicit refusal + repeated closure: PASS; cerrado_en set/unchanged, resuelto_en NULL.");

    const during = await snapshot();
    for (const table of tables) {
      if (!["colaboradores", "servicios", "tickets"].includes(table)) {
        assert.deepEqual(during[table], baseline[table]);
      }
    }
    assert.equal(during.colaboradores.count, baseline.colaboradores.count + 1);
    assert.equal(during.servicios.count, baseline.servicios.count + 1);
    assert.equal(during.tickets.count, baseline.tickets.count + 1);
    console.log("Counts inside transaction:", JSON.stringify(counts(during)));

    stage = "rollback and final verification";
    await client.query("ROLLBACK");
    outerOpen = false;
    await client.query("BEGIN READ ONLY");
    await guardNoResidue();
    assert.equal(await inspect(), schema);
    const final = await snapshot();
    assert.deepEqual(final, baseline);
    await client.query("ROLLBACK");
    rollbackVerified = true;
    console.log("Final counts:", JSON.stringify(counts(final)));
    console.log("ROLLBACK + no fixture residue + all 11 table fingerprints/schema unchanged: PASS.");
    console.log("Cross-connection concurrency, durable COMMIT/restart: NOT EXECUTED (rollback isolation preferred).");
    console.log("Identity sequence: 3 INSERT attempts may consume values; sequence not reset.");

    async function guardNoResidue() {
      const { rows: [row] } = await client.query(`
        SELECT
          (SELECT count(*)::int FROM public.colaboradores WHERE id_colaborador=$1) +
          (SELECT count(*)::int FROM public.servicios WHERE id_servicio=$2) +
          (SELECT count(*)::int FROM public.tickets
            WHERE id_colaborador=$1 OR id_servicio=$2 OR id_mensaje_confirmacion=$3) AS n`,
      [owner, service, confirmation]);
      assert.equal(row.n, 0);
    }
  }
} catch (error) {
  console.error(`FAIL at ${stage}; details suppressed (${error instanceof assert.AssertionError
    ? "assertion" : "integration error"}).`);
  process.exitCode = 1;
} finally {
  if (client) {
    try {
      await client.query("ROLLBACK");
      if (outerOpen) console.log("Failure cleanup: outer ROLLBACK acknowledged; final comparison not completed.");
    } catch {
      console.error("ROLLBACK acknowledgment unavailable; connection will be closed; manual read-only verification required.");
      process.exitCode = 1;
    }
    client.release(true);
  }
  await pool.end();
  if (authorized && !rollbackVerified) {
    console.log("Integrated validation incomplete; no PASS claimed.");
  }
}
