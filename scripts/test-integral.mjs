import assert from "node:assert/strict";
import {scryptSync} from "node:crypto";
import {verifyLogin,readSession,signSession,sameOrigin} from "../src/lib/server/admin-auth.ts";
import {sendWhatsApp} from "../src/lib/server/whatsapp-outbound.ts";
import {groundedAnswer,driveId} from "../src/lib/server/institutional-sources.ts";
import {contentHash} from "../src/lib/server/library-contract.ts";
import {createDemoStore} from "../src/lib/server/demo-store.ts";
import {startMaintenance} from "../src/lib/server/maintenance.ts";
import {exportMonth} from "../src/lib/server/monthly-export.ts";
import {createSheetsFixture} from "./helpers/sheets-fixture.mjs";
let groups=0;const pass=name=>{groups++;console.log(name+": PASS");};
// In-process, fictional-only auth configuration. Does not change Replit Secrets.
const original={accounts:process.env.RH_ADMIN_ACCOUNTS,secret:process.env.SESSION_SECRET};
try {
  process.env.SESSION_SECRET="synthetic-unit-test-session-key";
  const salt="ab".repeat(16),password="synthetic-test-only";
  process.env.RH_ADMIN_ACCOUNTS=JSON.stringify([{email:"synthetic@example.invalid",role:"gerente",salt,hash:scryptSync(password,salt,64).toString("hex")}]);
  assert.equal(verifyLogin("synthetic@example.invalid","wrong"),null);
  assert.equal(verifyLogin("other@example.invalid",password),null);
  const admin=verifyLogin("synthetic@example.invalid",password);assert.equal(admin.role,"gerente");
  const cookie=signSession(admin);assert.equal(readSession(cookie).role,"gerente");assert.equal(readSession(cookie+"x"),null);
  process.env.RH_ADMIN_ACCOUNTS="[]";assert.equal(readSession(cookie),null);
  assert(!sameOrigin(new Request("https://synthetic.invalid",{method:"POST",headers:{origin:"https://attacker.invalid"}})));
  pass("Autenticación específica, fallo cerrado, firma, revocación y CSRF");
}finally{
  if(original.accounts===undefined)delete process.env.RH_ADMIN_ACCOUNTS;else process.env.RH_ADMIN_ACCOUNTS=original.accounts;
  if(original.secret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=original.secret;
}
let network=0;
assert.equal((await sendWhatsApp({to:"000000000000",kind:"text",text:"synthetic",lastInboundAt:Date.now()},null,async()=>{network++;throw new Error();})).status,"BLOCKED");
assert.equal(network,0);pass("Transporte WhatsApp bloqueado sin efectuar petición externa");
assert.throws(()=>driveId("https://attacker.invalid/document/123"));
const source={id_fuente:"1",nombre:"Documento ficticio",categoria:"Vacaciones",url_drive:"https://docs.google.com/document/d/synthetic-document-only",version:"TEST",vigente_desde:"2026-01-01",activo:true};
const extract="Las vacaciones de esta política ficticia requieren autorización previa por el procedimiento descrito en este documento de prueba.";
source.biblioteca={v:1,kind:"document",driveId:"synthetic-document-only",status:"APROBADO",type:"POLITICA/PREGUNTAS_TRABAJADOR",hash:contentHash(extract),
  approval:{actor:"synthetic@example.invalid",at:"2026-01-01T12:00:00Z",hash:contentHash(extract),version:"TEST",scope:"Respuesta ficticia para trabajadores",fragments:[extract],validFrom:"2026-01-01"}};
const grounded=await groundedAnswer("¿Las vacaciones requieren autorización previa?","Vacaciones",[source],async()=>extract);
assert(grounded&&grounded.text.includes(extract)&&grounded.text.includes("versión TEST"));
let liveDriveReads=0;
assert((await groundedAnswer("vacaciones autorización previa","Vacaciones",[source],async()=>{liveDriveReads++;throw new Error("Drive must not be called in a worker turn");})));
assert.equal(liveDriveReads,0);
assert.equal(await groundedAnswer("vacaciones autorización previa","Vacaciones",[{...source,activo:false}],async()=>extract),null);
assert((await groundedAnswer("vacaciones autorización previa","Vacaciones",[{...source,vigente_desde:null}],async()=>extract)));
assert((await groundedAnswer("vacaciones autorización previa","Vacaciones",[{...source,vigente_desde:"2099-01-01"}],async()=>extract)));
assert(!grounded.text.includes("vigente desde"));
pass("Fuentes: texto aprobado, cita/version, sin depender de fechas; permiso ausente bloqueado");
const demo=createDemoStore(),other=createDemoStore();
let n=0;const send=text=>demo.conversation(text,"synthetic-demo-"+(++n));
await send("hola");await send("1");await send("Pago semanal");await send("13/11/2026");
await send("El pago semanal de prueba no coincide con el resumen ficticio.");
assert.equal(demo.read("tickets").length,1);
await send("confirmo");assert.equal(demo.read("tickets").length,2);
await send("no");assert.equal(demo.read("tickets").filter(t=>t.estado==="cerrado sin cita").length,1);
pass("Simulación nómina completa con folio y negativa expresa, sin resolver");
await send("menú principal");await send("2");await send("Quiero conocer los requisitos para solicitar vacaciones");
await send("confirmo");assert.equal(demo.read("consultas").length,2);
await send("sí");await send("1");const booked=await send("confirmo");assert.equal(booked.action,"remote_registered");
pass("Simulación políticas sin fuente, consulta/faltante/ticket y cita remota");
await send("menú principal");await send("3");await send("Quejas y denuncias");
await send("Queja completamente ficticia sobre organización del área de demostración.");await send("confirmo");await send("no");
assert.equal(demo.read("voz").length,2);assert.equal(other.read("voz").length,1);
assert.equal(other.read("tickets").length,1);
pass("Simulación Tu Voz con confirmación/consentimiento, aislamiento entre visitantes");
await demo.write("colaboradores","save",{id_colaborador:"DEMO-SECOND",nombre:"Persona ficticia",whatsapp:"000000000000002",centro:"Prueba",departamento:"Prueba",puesto:"Prueba",activo:true});
assert.equal(demo.read("colaboradores").length,2);assert.equal(other.read("colaboradores").length,1);
const before=demo.read("tickets").length;await demo.conversation("hola","same-demo");
await demo.conversation("hola","same-demo");await assert.rejects(demo.conversation("different","same-demo"));
assert.equal(demo.read("tickets").length,before);
pass("CRUD demo aislado y clave repetida/conflictiva sin duplicidad");
let tick,stopped=false;
const sql=[];
const client={async query(q){sql.push(q);return {rows:[],rowCount:0};},release(){}};
const fakePool={async connect(){return client;}};
const worker=startMaintenance(fakePool,{schedule:run=>{tick=run;return ()=>{stopped=true;};}});
await worker.run();
assert(sql.some(q=>q.includes("DELETE FROM public.contextos_conversacion")));
assert(sql.some(q=>q.includes("INSERT INTO public.encuestas")));
assert(!sql.some(q=>/DELETE FROM public\.(tickets|citas|operaciones_citas|eventos_entrantes)/.test(q)));
worker.dispose();assert(stopped);
const count=sql.length;tick();await new Promise(r=>setImmediate(r));assert.equal(sql.length,count);
pass("Mantenimiento con temporizador inyectado, encuestas preparadas y sin purgar recibos");
const oldTarget=process.env.RH_EXPORT_SPREADSHEET_ID;
try{
  process.env.RH_EXPORT_SPREADSHEET_ID="1lLpgaLr3Y7-9u0p45alq3txRS42M8mQAesu3gibXpvI"; // Mock transport only.
  const archiveCalls=[],exportSql=[];
  const sheets=createSheetsFixture("Tickets_2026_11",{lostAckOnce:true}),proxy=sheets.proxy,exported=sheets.rows;
  const exportPool={async connect(){return {release(){},async query(q,params){
    exportSql.push(q);
    if(q.includes("pg_try_advisory_xact_lock"))return {rows:[{acquired:true}]};
    if(q.includes("FROM public.tickets"))return {rows:[
      {id_ticket:"100",categoria:"Nómina y prestaciones",resumen:"=SYNTHETIC",estado:"cerrado sin cita",cerrado_en:"2026-11-01T12:00:00Z"},
      {id_ticket:"101",categoria:"Políticas y procedimientos",resumen:"SYNTHETIC",estado:"cerrado",cerrado_en:"2026-11-01T12:00:00Z"}]};
    if(q.startsWith("UPDATE public.tickets"))archiveCalls.push(params[0]);
    return {rows:[]};
  }};}};
  await assert.rejects(exportMonth(exportPool,"2026-11",{proxy}),e=>e.code==="SHEETS_CONNECTION_PENDING");
  assert.equal(archiveCalls.length,0);
  const recovered=await exportMonth(exportPool,"2026-11",{proxy});
  assert.deepEqual(recovered,{archived:2,appended:0,deleted:0});
  assert.equal(sheets.appends,1);assert.equal(exported.length,3);assert.equal(exported[1][5],"'=SYNTHETIC");
  assert(exportSql.some(q=>q.includes("s.categoria IN ('Nómina y prestaciones','Políticas y procedimientos')")));
  assert(!exportSql.some(q=>/DELETE|denuncias/.test(q)));
  pass("Sheets simulado: acuse perdido, relectura/deduplicación, archivado solo verificado y sin Tu Voz");
}finally{if(oldTarget===undefined)delete process.env.RH_EXPORT_SPREADSHEET_ID;else process.env.RH_EXPORT_SPREADSHEET_ID=oldTarget;}
console.log(`INTEGRAL LOCAL: ${groups} grupos PASS; sin Neon, Meta ni cambios de Secrets.`);
