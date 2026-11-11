import pg from "pg";
import { readFile } from "node:fs/promises";
const c = new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true}});
try {
  await c.connect();
  const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  if(tables.length!==12||tables.includes("contextos_conversacion")||tables.includes("eventos_entrantes"))
    throw new Error("SCHEMA_PRECONDITION");
  const column=(await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='encuestas' AND column_name='recibio_atencion'")).rowCount;
  if(column)throw new Error("COLUMN_ALREADY_EXISTS");
  const baseline={};
  for(const t of tables)baseline[t]=(await c.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) AS fingerprint FROM public.${t} t`)).rows[0];
  if(baseline.servicios.count!==15||baseline.horarios_atencion.count!==5)throw new Error("CATALOG_PRECONDITION");
  console.log(JSON.stringify({phase:"baseline",tables:tables.length,rows:baseline}));
  if(!process.argv.includes("--apply-authorized")){console.log("SELECT_ONLY");process.exitCode=0;}
  else {
    const started=Date.now();
    await c.query(await readFile("migrations/001_contexto_eventos_encuestas.sql","utf8"));
    const unchanged={};
    for(const t of tables) {
      // Compare existing columns only: the additive NULL must not change row fingerprints.
      const projection=t==="encuestas"?"to_jsonb(t)-'recibio_atencion'":"to_jsonb(t)";
      const after=(await c.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg((${projection})::text,'|' ORDER BY (${projection})::text),'')) AS fingerprint FROM public.${t} t`)).rows[0];
      unchanged[t]=JSON.stringify(after)===JSON.stringify(baseline[t]);
    }
    console.log(JSON.stringify({phase:"committed",elapsedMs:Date.now()-started,unchanged,
      tables:(await c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,
      constraints:(await c.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid IN ('public.contextos_conversacion'::regclass,'public.eventos_entrantes'::regclass)")).rows[0].n}));
    if(Object.values(unchanged).some(v=>!v))process.exitCode=1;
  }
} catch {await c.query("ROLLBACK").catch(()=>{});console.log("MIGRATION_FAILED_NO_SECRET_DETAILS");process.exitCode=1;}
finally{await c.end();}
