import assert from "node:assert/strict";
import pg from "pg";
import {randomBytes} from "node:crypto";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
import {OWNER_EMAIL,INITIAL_MANAGER_EMAIL,changeAccess,listAccess,accountAccess} from "../src/lib/server/admin-users.ts";
import {loginWithAccess,signAccessSession,readAccessSession} from "../src/lib/server/admin-access-auth.ts";
import {createAccount,createInitialAccounts} from "./admin-bootstrap.mjs";
import {readDriveText} from "../src/lib/server/institutional-sources.ts";
const p=new pg.Pool(neonPoolOptions()),c=await p.connect();
let groups=0;const pass=s=>{groups++;console.log(s+": PASS");};
const snapshot=async()=>{
 const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename),result={};
 assert.equal(tables.length,16);
 for(const t of tables){assert.match(t,/^[a-z_]+$/);result[t]=(await c.query(`SELECT count(*)::int n,md5(COALESCE(string_agg(row_to_json(r)::text,'|' ORDER BY row_to_json(r)::text),'')) hash FROM public.${t} r`)).rows[0];}
 return JSON.stringify(result);
};
let baseline;
let sequenceBefore;
try{
 baseline=await snapshot();
 sequenceBefore=(await c.query("SELECT last_value::text FROM pg_sequences WHERE schemaname='public' AND sequencename='auditoria_accesos_id_seq'")).rows[0]?.last_value;
 assert.equal((await c.query("SELECT count(*)::int n FROM usuarios_rh")).rows[0].n,0,"Never test over existing accounts");
 await c.query("BEGIN");await c.query("SET LOCAL statement_timeout='10s'");
  const owner={email:OWNER_EMAIL,role:"gerente"},manager={email:INITIAL_MANAGER_EMAIL,role:"generalista"};
 const pool={query:(...a)=>c.query(...a),connect:async()=>({
  query:(sql,args)=>c.query(sql==="BEGIN"?"SAVEPOINT access_case":sql==="COMMIT"?"RELEASE SAVEPOINT access_case":sql==="ROLLBACK"?"ROLLBACK TO SAVEPOINT access_case":sql,args),
  release(){}
 })};
  const ownerPassword=randomBytes(24).toString("base64url"),managerPassword=randomBytes(24).toString("base64url");
  const [ownerAccount,managerAccount]=createInitialAccounts(ownerPassword,managerPassword);
  assert.equal(ownerAccount.email,OWNER_EMAIL);assert.equal(ownerAccount.role,"gerente");
  assert.equal(managerAccount.email,INITIAL_MANAGER_EMAIL);assert.equal(managerAccount.role,"generalista");
  assert.notEqual(ownerAccount.hash,managerAccount.hash);
  assert.throws(()=>createInitialAccounts("same-private-password","same-private-password"),/PASSWORDS_MUST_BE_DIFFERENT/);
  process.env.SESSION_SECRET=randomBytes(32).toString("hex");
  process.env.RH_ADMIN_ACCOUNTS=JSON.stringify([ownerAccount,managerAccount]);
  assert.equal(await loginWithAccess(manager.email,managerPassword,pool),null);
  assert.equal((await c.query("SELECT count(*)::int n FROM usuarios_rh")).rows[0].n,0,"A manager cannot trigger initial bootstrap");
  process.env.RH_ADMIN_ACCOUNTS=JSON.stringify([...JSON.parse(process.env.RH_ADMIN_ACCOUNTS),createAccount("extra@example.invalid","generalista",randomBytes(24).toString("base64url"))]);
  assert.equal(await loginWithAccess(owner.email,ownerPassword,pool),null);
  assert.equal((await c.query("SELECT count(*)::int n FROM usuarios_rh")).rows[0].n,0,"Unexpected accounts must not bootstrap");
  process.env.RH_ADMIN_ACCOUNTS=JSON.stringify([ownerAccount,managerAccount]);
  assert.equal(await loginWithAccess(owner.email,"invalid-password",pool),null);
  assert.equal((await c.query("SELECT count(*)::int n FROM usuarios_rh")).rows[0].n,0,"An invalid password must not bootstrap");
  process.env.RH_ADMIN_ACCOUNTS=JSON.stringify([ownerAccount,managerAccount]);
  assert.equal(await loginWithAccess(owner.email,ownerPassword,pool).then(x=>x?.role), "gerente");
  assert.equal((await c.query("SELECT count(*)::int n FROM usuarios_rh")).rows[0].n,2);
  assert.equal(await loginWithAccess(owner.email,ownerPassword,pool).then(x=>x?.role),"gerente","Lost login response remains safely retryable");
  assert.equal(await loginWithAccess(manager.email,managerPassword,pool).then(x=>x?.role),"generalista");
  assert.equal((await accountAccess(pool,manager.email)).activo,true);
  pass("Primer acceso: solo credencial privada válida del administrador con el par exacto crea las dos cuentas; reintento no duplica");
 await assert.rejects(()=>listAccess(pool,manager));
 await assert.rejects(()=>changeAccess(pool,manager,{action:"add",email:"intruder@example.invalid"}));
 pass("Servidor deniega listado y cambios a gestores");
 for(const action of ["edit","deactivate","revoke","activate"])await assert.rejects(()=>changeAccess(pool,owner,{action,email:OWNER_EMAIL,newEmail:"other@example.invalid"}));
 await assert.rejects(()=>changeAccess(pool,owner,{action:"edit",email:manager.email,newEmail:OWNER_EMAIL}));
 await assert.rejects(()=>changeAccess(pool,owner,{action:"edit",email:manager.email,role:"gerente"}));
 pass("Alta gestor y administrador único protegido sin promoción ni transferencia");
 const password=randomBytes(24).toString("base64url");
 process.env.SESSION_SECRET=randomBytes(32).toString("hex");
 process.env.RH_ADMIN_ACCOUNTS=JSON.stringify([createAccount(OWNER_EMAIL,"gerente",password),createAccount(manager.email,"generalista",password)]);
 assert.equal(await loginWithAccess(manager.email,"not-the-password",pool),null);
 const a=await loginWithAccess(manager.email,password,pool);assert(a);
 const token=await signAccessSession(a,pool);assert(await readAccessSession(token,pool));
 await changeAccess(pool,owner,{action:"deactivate",email:manager.email});
 assert.equal(await readAccessSession(token,pool),null);assert.equal(await loginWithAccess(manager.email,password,pool),null);
 await changeAccess(pool,owner,{action:"activate",email:manager.email});
 assert.equal(await readAccessSession(token,pool),null);
 const token2=await signAccessSession(await loginWithAccess(manager.email,password,pool),pool);
 await changeAccess(pool,owner,{action:"revoke",email:manager.email});
 assert.equal(await readAccessSession(token2,pool),null);assert.equal(await loginWithAccess(manager.email,password,pool),null);
 pass("Contraseña necesaria; desactivar/revocar invalida sesiones y reactivar no revive las anteriores");
 await changeAccess(pool,owner,{action:"edit",email:manager.email,newEmail:"fixture-renamed@example.invalid"});
 assert.equal(await accountAccess(pool,manager.email),null);
 const listing=await listAccess(pool,owner);
 assert(listing.audit.length>=5);assert(listing.audit.every(x=>x.actor===OWNER_EMAIL&&x.fecha&&x.cuenta&&!Object.hasOwn(x,"hash")));
 assert(!JSON.stringify(listing).includes(password));
 pass("Edición de correo, auditoría transaccional y proyección sin credenciales");
 await c.query("SAVEPOINT constraint_case");
 await assert.rejects(()=>c.query("INSERT INTO usuarios_rh(email,role) VALUES('second@example.invalid','gerente')"));
 await c.query("ROLLBACK TO SAVEPOINT constraint_case");
 await assert.rejects(()=>c.query("UPDATE usuarios_rh SET activo=false WHERE email=$1",[OWNER_EMAIL]));
 await c.query("ROLLBACK TO SAVEPOINT constraint_case");
 pass("Restricciones SQL reales rechazan segundo administrador y desactivación del principal");
 await c.query("ROLLBACK");
 assert.equal(await snapshot(),baseline);
 pass("ROLLBACK: conteos y huellas de las 16 tablas idénticos; ninguna cuenta real creada");
 const id="syntheticDriveDocument001";
 const content=await readDriveText(id,async path=>path.includes("fields=")?Response.json({mimeType:"application/vnd.google-apps.document"}):new Response("Documento totalmente ficticio para la prueba de lectura."));
 assert(content.includes("ficticio"));
 await assert.rejects(()=>readDriveText(id,async()=>Response.json({mimeType:"image/png"})));
 await assert.rejects(()=>readDriveText(id,async()=>new Response("",{status:403})));
 await assert.rejects(()=>readDriveText(id,async path=>path.includes("fields=")?Response.json({mimeType:"application/pdf",size:10000001}):new Response("")));
 pass("Drive simulado: Docs legible, permisos denegados, tipo no admitido y PDF excesivo fallan seguros");
 const stream="BT /F1 12 Tf 30 700 Td (Synthetic institutional PDF fixture.) Tj ET";
 const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let document="%PDF-1.4\n";const offsets=[0];
 for(const [i,obj]of objects.entries()){offsets.push(Buffer.byteLength(document));document+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const xref=Buffer.byteLength(document);document+="xref\n0 6\n0000000000 65535 f \n"+offsets.slice(1).map(x=>String(x).padStart(10,"0")+" 00000 n \n").join("")+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const extracted=await readDriveText(id,async path=>path.includes("fields=")?Response.json({mimeType:"application/pdf"}):new Response(document));
 assert(extracted.includes("Synthetic institutional PDF fixture"));
 pass("Extracción PDF real local con documento enteramente ficticio; sin OCR ni acceso externo");
 const sequenceAfter=(await c.query("SELECT last_value::text FROM pg_sequences WHERE schemaname='public' AND sequencename='auditoria_accesos_id_seq'")).rows[0]?.last_value;
 console.log(JSON.stringify({auditSequenceBefore:sequenceBefore??"unused",auditSequenceAfter:sequenceAfter,all16FingerprintsEqual:true}));
 console.log(`Administración: ${groups} grupos PASS; SQL real solo ROLLBACK, sin COMMIT de fixtures.`);
}catch(e){await c.query("ROLLBACK").catch(()=>{});console.error("ADMIN_TEST_FAIL",e.code??e.message);process.exitCode=1;}
finally{c.release();await p.end();}
