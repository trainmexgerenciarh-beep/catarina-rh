import assert from "node:assert/strict";
import pg from "pg";
import {createHash} from "node:crypto";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
const p=new pg.Pool(neonPoolOptions()),c=await p.connect();
try{
  await c.query("BEGIN");
  await c.query("SET LOCAL lock_timeout='3s'");
  await c.query("SET LOCAL statement_timeout='10s'");
  const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  assert.equal(tables.length,14);
  const columns=(await c.query("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='encuestas' ORDER BY ordinal_position")).rows;
  const existing=columns.find(x=>x.column_name==="entrega");
  assert(columns.some(x=>x.column_name==="recibio_atencion"&&x.data_type==="boolean"));
  if(existing){assert.equal(existing.data_type,"jsonb");assert.equal(existing.is_nullable,"YES");console.log("ALREADY_PRESENT: no DDL executed");}
  const snapshot=async()=>{const result={};for(const t of tables){assert(/^[a-z_]+$/.test(t));result[t]=(await c.query(`SELECT count(*)::int n,md5(coalesce(string_agg(to_jsonb(r)::text,'|' ORDER BY to_jsonb(r)::text),'')) hash FROM public.${t} r`)).rows[0];}return result;};
  const before=await snapshot();
  console.log(JSON.stringify({phase:"read-only",tables:tables.length,counts:Object.fromEntries(tables.map(t=>[t,before[t].n])),columnPresent:Boolean(existing)}));
  if(!existing&&process.argv.includes("--authorized-add-column")){
    // Exactly one nullable column; NO extra constraint/index/default/backfill.
    await c.query("ALTER TABLE public.encuestas ADD COLUMN entrega JSONB");
    const check=(await c.query("SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='encuestas' AND column_name='entrega'")).rows[0];
    assert.deepEqual(check,{data_type:"jsonb",is_nullable:"YES",column_default:null});
    // The added null field changes row JSON only for encuestas; compare old projection.
    const after=await snapshot();
    for(const t of tables.filter(t=>t!=="encuestas"))assert.deepEqual(after[t],before[t]);
    const oldProjection=(await c.query("SELECT count(*)::int n,md5(coalesce(string_agg((to_jsonb(r)-'entrega')::text,'|' ORDER BY (to_jsonb(r)-'entrega')::text),'')) hash FROM public.encuestas r")).rows[0];
    assert.deepEqual(oldProjection,before.encuestas);
    await c.query("COMMIT");
    console.log(JSON.stringify({migration:"COMMIT PASS",objects:["public.encuestas.entrega JSONB NULL"],unchanged14Data:true,fingerprint:createHash("sha256").update(JSON.stringify(before)).digest("hex")}));
  }else{await c.query("ROLLBACK");console.log("READ_ONLY PASS");}
}catch(e){await c.query("ROLLBACK").catch(()=>{});console.error("MIGRATION_FAILED",e.code??e.message);process.exitCode=1;}
finally{c.release();await p.end();}
