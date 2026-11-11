import pg from "pg";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
export const ddl=`
CREATE TABLE public.usuarios_rh(
 email TEXT PRIMARY KEY CHECK(email=lower(email) AND length(email)<=254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'),
 role TEXT NOT NULL CHECK(role IN ('gerente','generalista')),
 activo BOOLEAN NOT NULL DEFAULT true,
 revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0),
 creado_en TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK((role='gerente' AND email='trainmexgerenciarh@gmail.com' AND activo) OR
       (role='generalista' AND email<>'trainmexgerenciarh@gmail.com'))
);
CREATE UNIQUE INDEX usuarios_rh_unico_administrador ON public.usuarios_rh(role) WHERE role='gerente';
CREATE TABLE public.auditoria_accesos(
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor TEXT NOT NULL, accion TEXT NOT NULL, cuenta TEXT NOT NULL,
 fecha TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);`;
if(process.argv.includes("--authorized-additive-admin")){
 const p=new pg.Pool(neonPoolOptions()),c=await p.connect();
 try{
  await c.query("BEGIN");await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='10s'");
  const existing=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename IN ('usuarios_rh','auditoria_accesos') OR tablename ~ '(admin|acceso|usuario)')")).rows;
  if(existing.length)throw Error("EXISTING_ADMIN_STRUCTURE_REQUIRES_REVIEW");
  const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  if(tables.length!==14||tables.some(t=>!/^[a-z_]+$/.test(t)))throw Error("SCHEMA_BASELINE_MISMATCH");
  const snapshot=async()=>{
    const result={};
    for(const t of tables)result[t]=(await c.query(`SELECT count(*)::int n,md5(COALESCE(string_agg(row_to_json(r)::text,'|' ORDER BY row_to_json(r)::text),'')) hash FROM public.${t} r`)).rows[0];
    return JSON.stringify(result);
  };
  const before=await snapshot();
  await c.query(ddl);
  if(before!==await snapshot())throw Error("BASELINE_DATA_CHANGED");
  await c.query("COMMIT");
  console.log("PASS: COMMIT dos tablas aditivas e índice; huellas de las 14 tablas anteriores iguales; sin cuentas ni credenciales creadas");
 }catch(e){await c.query("ROLLBACK");console.error("ADMIN_MIGRATION_FAILED",e.code??"PRECONDITION");process.exitCode=1;}
 finally{c.release();await p.end();}
}
