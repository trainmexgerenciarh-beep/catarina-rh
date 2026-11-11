import pg from "pg";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
import {OWNER_EMAIL,INITIAL_MANAGER_EMAIL} from "../src/lib/server/admin-users.ts";
import {adminConfigured} from "../src/lib/server/admin-auth.ts";
// Explicit private bootstrap only; never called at app startup.
if(!process.argv.includes("--verified-private-config"))throw Error("EXPLICIT_PRIVATE_BOOTSTRAP_REQUIRED");
if(!adminConfigured())throw Error("PRIVATE_ACCOUNTS_AND_SESSION_SECRET_REQUIRED");
const accounts=JSON.parse(process.env.RH_ADMIN_ACCOUNTS);
if(accounts.length!==2||!accounts.some(a=>a.email===OWNER_EMAIL&&a.role==="gerente")||
 !accounts.some(a=>a.email===INITIAL_MANAGER_EMAIL&&a.role==="generalista"))throw Error("EXACT_AUTHORIZED_INITIAL_ACCOUNTS_REQUIRED");
const p=new pg.Pool(neonPoolOptions()),c=await p.connect();
try{
 await c.query("BEGIN");await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='8s'");
 await c.query("SELECT pg_advisory_xact_lock(7412061)");
 if((await c.query("SELECT 1 FROM public.usuarios_rh LIMIT 1")).rowCount)throw Error("BOOTSTRAP_ALREADY_COMPLETED");
 for(const a of accounts){
  await c.query("INSERT INTO public.usuarios_rh(email,role) VALUES($1,$2)",[a.email,a.role]);
  await c.query("INSERT INTO public.auditoria_accesos(actor,accion,cuenta) VALUES($1,'bootstrap',$2)",[OWNER_EMAIL,a.email]);
 }
 await c.query("COMMIT");console.log("PASS: metadatos de dos cuentas autorizadas activados; ninguna contraseña almacenada en Neon.");
}catch(e){await c.query("ROLLBACK");console.error("BOOTSTRAP_FAILED",e.code??"PRECONDITION");process.exitCode=1;}
finally{c.release();await p.end();}
