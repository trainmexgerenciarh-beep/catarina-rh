import pg from "pg";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
if(!process.argv.includes("--authorized-library-column"))throw new Error("EXPLICIT_AUTHORIZATION_REQUIRED");
const p=new pg.Pool(neonPoolOptions()),c=await p.connect();let begun=false;
const snapshot=async()=>{
  const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  if(tables.length!==16)throw new Error("SCHEMA_REVIEW_REQUIRED");
  const result={};
  for(const t of tables){
    if(!/^[a-z_]+$/.test(t))throw new Error("UNEXPECTED_IDENTIFIER");
    result[t]=(await c.query(`SELECT count(*)::int n,
      md5(coalesce(string_agg((to_jsonb(r)-'biblioteca')::text,'|' ORDER BY (to_jsonb(r)-'biblioteca')::text),'')) hash FROM public.${t} r`)).rows[0];
  }return JSON.stringify(result);
};
try{
  const col=(await c.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='fuentes' AND column_name='biblioteca'")).rows[0];
  if(col){if(col.data_type!=="jsonb"||col.is_nullable!=="YES")throw new Error("INCOMPATIBLE_LIBRARY_COLUMN");console.log("Columna compatible existente; sin DDL.");}
  else{
    const before=await snapshot();const start=Date.now();
    await c.query("BEGIN");begun=true;
    await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='10s'");
    await c.query("ALTER TABLE public.fuentes ADD COLUMN biblioteca JSONB");
    if(await snapshot()!==before)throw new Error("EXISTING_ROWS_CHANGED");
    await c.query("COMMIT");begun=false;
    console.log(JSON.stringify({ddl:"ADD fuentes.biblioteca JSONB NULL",transaction:"COMMIT",elapsedMs:Date.now()-start,all16ExistingFingerprintsEqual:true}));
  }
  const verified=(await c.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='fuentes' AND column_name='biblioteca'")).rows[0];
  if(verified?.data_type!=="jsonb"||verified?.is_nullable!=="YES")throw new Error("VERIFICATION_FAILED");
  console.log(JSON.stringify((await c.query("SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='public') tables,(SELECT count(*) FROM servicios WHERE activo) services,(SELECT count(*) FROM horarios_atencion) hours,(SELECT count(*) FROM fuentes) sources")).rows[0]));
}catch(e){if(begun)await c.query("ROLLBACK");console.error("LIBRARY_MIGRATION_FAIL",e.code??e.message);process.exitCode=1;}
finally{c.release();await p.end();}
