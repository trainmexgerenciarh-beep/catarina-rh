import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const tables = [
  "bloqueos_agenda", "citas", "colaboradores", "consultas", "denuncias", "encuestas",
  "fuentes", "horarios_atencion", "operaciones_citas", "seguimientos_denuncia", "servicios", "tickets"
];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])]));
  return value;
}
// JSONB does not preserve object key insertion order. Compare content, not
// transport serialization; this is a test digest, NOT the command fingerprint.
export const digest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export async function snapshot(c) {
  const result = {};
  for (const t of tables) {
    result[t] = (await c.query(`SELECT count(*)::int AS count,
      md5(coalesce(string_agg(h,'' ORDER BY h),'')) AS fingerprint
      FROM (SELECT md5(to_jsonb(r)::text) h FROM public.${t} r) s`)).rows[0];
  }
  return result;
}
export const counts = s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.count]));
export async function inspect(c) {
  const found = (await c.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows;
  assert.deepEqual(found.map(r => r.table_name), tables);
  const columns = (await c.query(`SELECT table_name,column_name,data_type,is_nullable,
    is_identity,column_default FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows;
  const constraints = (await c.query(`SELECT conrelid::regclass::text AS source,
    confrelid::regclass::text AS target,contype,convalidated,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE connamespace='public'::regnamespace OR
    confrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
    ORDER BY conrelid,conname`)).rows;
  assert(constraints.every(r => r.convalidated));
  assert(constraints.filter(r => r.contype === "f").every(r =>
    tables.includes(r.source) && tables.includes(r.target)), "Unexpected dependency");
  for (const expected of [
    ["tickets", "u", "UNIQUE (id_mensaje_confirmacion)"],
    ["citas", "x", "EXCLUDE USING gist"],
    ["citas", "c", "isfinite"],
    ["operaciones_citas", "p", "PRIMARY KEY (id_evento_meta)"]
  ]) assert(constraints.some(r => r.source === expected[0] &&
    r.contype === expected[1] && r.definition.includes(expected[2])));
  const indexes = (await c.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' ORDER BY tablename,indexname`)).rows;
  assert(indexes.some(r => r.indexdef.includes("UNIQUE") &&
    r.indexdef.includes("id_ticket") && r.indexdef.includes("PROGRAMADA")));
  assert.equal((await c.query(`SELECT count(*)::int AS n FROM pg_index
    WHERE indrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
    AND (NOT indisvalid OR NOT indisready)`)).rows[0].n, 0);
  assert.equal((await c.query(`SELECT count(*)::int AS n FROM pg_trigger
    WHERE NOT tgisinternal AND tgrelid IN
    (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)`)).rows[0].n, 0);
  const guards = (await c.query(`SELECT relname,relrowsecurity,relforcerowsecurity,
    has_table_privilege(oid,'SELECT,INSERT,UPDATE,DELETE') AS allowed
    FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname`)).rows;
  assert(guards.every(r => !r.relrowsecurity && !r.relforcerowsecurity && r.allowed));
  const hours = (await c.query(`SELECT dia_semana,hora_inicio::text,hora_fin::text,
    duracion_cita,activo FROM public.horarios_atencion ORDER BY dia_semana`)).rows;
  assert.deepEqual(hours, [1,2,3,4,5].map(d => ({
    dia_semana:d,hora_inicio:"14:00:00",hora_fin:"17:30:00",duracion_cita:20,activo:true
  })));
  const services = (await c.query(`SELECT categoria,count(*)::int AS n,
    count(*) FILTER (WHERE activo IS TRUE)::int AS active FROM public.servicios
    GROUP BY categoria ORDER BY categoria`)).rows;
  assert.deepEqual(services, [
    {categoria:"Nómina y prestaciones",n:8,active:8},
    {categoria:"Políticas y procedimientos",n:5,active:5},
    {categoria:"Tu Voz en Trainmex",n:2,active:2}
  ]);
  return digest({columns,constraints,indexes,guards,hours,services});
}
export async function sequences(c) {
  return (await c.query(`SELECT sequencename,last_value::text,increment_by::text,cache_size::text
    FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`)).rows;
}
export async function locked(c, run) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL lock_timeout='3s'");
    await c.query("SET LOCAL statement_timeout='30s'");
    await c.query("SELECT pg_advisory_xact_lock($1::bigint)", ["2026111001"]);
    // Fixed allowlist. Fail on another writer, never wait indefinitely.
    await c.query(`LOCK TABLE ${tables.map(t => `public.${t}`).join(",")}
      IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
    const result = await run();
    await c.query("COMMIT");
    return result;
  } catch (e) { await c.query("ROLLBACK"); throw e; }
}

/** SELECT-only boundary probe: one materialized PostgreSQL clock AFTER a real
 * advisory-lock wait. It does not pretend network round trips preserve equality.
 */
export async function postLockBoundary(observer, firstPool, secondPool) {
  const first=await firstPool.connect(),second=await secondPool.connect();
  let pending;
  try {
    await first.query("BEGIN");await second.query("BEGIN");
    await second.query("SET LOCAL lock_timeout='5s'");
    await first.query("SELECT pg_advisory_xact_lock($1::bigint)",["2026111001"]);
    const before=Number((await first.query(
      "SELECT extract(epoch FROM clock_timestamp())*1000 AS now")).rows[0].now);
    const pid=(await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending=second.query(`WITH acquired AS MATERIALIZED
      (SELECT pg_advisory_xact_lock($1::bigint)),
      n AS MATERIALIZED (SELECT clock_timestamp() AS now FROM acquired)
      SELECT extract(epoch FROM now)*1000 AS now,
        now+interval '120 minutes'>=now+interval '120 minutes' AS inclusive,
        now+interval '119 minutes 59 seconds'>=now+interval '120 minutes' AS short FROM n`,
      ["2026111001"]);
    // Observe the actual backend dependency, not just an elapsed local timer.
    let waited=false;
    for(let i=0;i<40;i++){
      if((await observer.query("SELECT cardinality(pg_blocking_pids($1)) AS n",[pid])).rows[0].n>0){
        waited=true;break;
      }
      await new Promise(r=>setTimeout(r,25));
    }
    assert(waited,"Actual SQL lock wait not observed");
    await new Promise(r=>setTimeout(r,150));
    await first.query("ROLLBACK");
    const row=(await pending).rows[0];
    assert(Number(row.now)>=before+150);
    assert.equal(row.inclusive,true);assert.equal(row.short,false);
    return {waitObserved:true,inclusive:true,short:false};
  } finally {
    await first.query("ROLLBACK");
    // Drain an in-flight query before rolling back/releasing its connection.
    if(pending)await pending.catch(()=>{});
    await second.query("ROLLBACK");
    first.release();second.release();
  }
}

/** Discover only this run, validate every dependency, then delete exact IDs.
 * No broad DELETE, CASCADE, sequence reset, schema alteration or service writes.
 */
export async function clean(c, manifest, baseline, schema) {
  return locked(c, async () => {
    assert.equal(await inspect(c), schema);
    const {owner,prefix} = manifest;
    assert(owner.startsWith("SYNTHETIC-C3-") && prefix.startsWith("SYNTHETIC-C3-"));
    const ownerRows = (await c.query(`SELECT nombre,whatsapp,activo FROM public.colaboradores
      WHERE id_colaborador=$1`, [owner])).rows;
    assert(ownerRows.length <= 1);
    if (ownerRows.length) assert.deepEqual(ownerRows[0], {
      nombre:"PRUEBA SINTETICA 02-C3 - NO ES PERSONA",whatsapp:null,activo:true
    });
    const ticketRows = (await c.query(`SELECT id_ticket::text AS id,id_mensaje_confirmacion AS event,
      descripcion,resumen FROM public.tickets WHERE id_colaborador=$1`, [owner])).rows;
    assert(ticketRows.every(r => r.event?.startsWith(prefix) &&
      r.descripcion === "PRUEBA SINTETICA 02-C3" && r.resumen === "PRUEBA SINTETICA 02-C3"));
    const ticketIds = ticketRows.map(r => r.id);
    const citaRows = (await c.query(`SELECT id_cita::text AS id FROM public.citas
      WHERE id_ticket=ANY($1::bigint[])`, [ticketIds])).rows;
    const citaIds = citaRows.map(r => r.id);
    const receiptRows = (await c.query(`SELECT id_evento_meta AS event,id_ticket::text AS ticket,
      id_cita::text AS cita FROM public.operaciones_citas
      WHERE id_ticket=ANY($1::bigint[]) OR id_cita=ANY($2::bigint[])
      OR starts_with(id_evento_meta,$3)`, [ticketIds,citaIds,prefix])).rows;
    assert(receiptRows.every(r => r.event.startsWith(prefix) &&
      ticketIds.includes(r.ticket) && citaIds.includes(r.cita)));
    // FK dependents not created by this suite must be absent before any DELETE.
    for (const [t,col,ids] of [
      ["consultas","id_ticket",ticketIds],["encuestas","id_cita",citaIds]
    ]) assert.equal((await c.query(`SELECT count(*)::int AS n FROM public.${t}
      WHERE ${col}=ANY($1::bigint[])`, [ids])).rows[0].n, 0);
    for (const t of ["consultas","denuncias"]) assert.equal((await c.query(
      `SELECT count(*)::int AS n FROM public.${t} WHERE id_colaborador=$1`,[owner])).rows[0].n,0);
    const blockIds = (await c.query(`SELECT id_bloqueo::text AS id FROM public.bloqueos_agenda
      WHERE motivo=$1`, [prefix+"block"])).rows.map(r => r.id);
    assert(blockIds.length <= 1);
    const deleted = {};
    for (const [t,col,ids,cast] of [
      ["operaciones_citas","id_evento_meta",receiptRows.map(r => r.event),"text"],
      ["citas","id_cita",citaIds,"bigint"],["tickets","id_ticket",ticketIds,"bigint"],
      ["bloqueos_agenda","id_bloqueo",blockIds,"bigint"],
      ["colaboradores","id_colaborador",ownerRows.length ? [owner] : [],"text"]
    ]) {
      const r = await c.query(`DELETE FROM public.${t} WHERE ${col}=ANY($1::${cast}[])`,[ids]);
      assert.equal(r.rowCount,ids.length);
      deleted[t]=r.rowCount;
    }
    assert.deepEqual(await snapshot(c),baseline,"Baseline mismatch; cleanup transaction rolled back");
    assert.equal(await inspect(c),schema);
    return deleted;
  });
}
