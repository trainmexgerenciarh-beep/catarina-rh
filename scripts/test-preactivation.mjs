import assert from"node:assert/strict";
import{scryptSync}from"node:crypto";
import{verifyLogin,signSession,readSession,revokeSession,sameOrigin,adminConfigured}from"../src/lib/server/admin-auth.ts";
import{createSurveyDispatcher,MemoryDeliveryRepository}from"../src/lib/server/survey-dispatcher.ts";
import{createCronHandler}from"../src/lib/server/cron-handler.ts";
import{readJsonObject}from"../src/lib/server/request-json.ts";
import{sendWhatsApp,OutboundFailure}from"../src/lib/server/whatsapp-outbound.ts";
import{exportMonth,inspectExportDestination}from"../src/lib/server/monthly-export.ts";
import{createAccount}from"./admin-bootstrap.mjs";
import{createSheetsFixture}from"./helpers/sheets-fixture.mjs";
let groups=0;const pass=name=>{groups++;console.log(name+": PASS");};
const touched=["SESSION_SECRET","RH_ADMIN_ACCOUNTS","WHATSAPP_ACCESS_TOKEN","WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_OUTBOUND_APPROVED","WHATSAPP_OUTBOUND_ALLOWLIST","RH_EXPORT_SPREADSHEET_ID"];
const before=new Map(touched.map(k=>[k,process.env[k]]));
try{
  const a=createAccount("synthetic-manager@example.invalid","gerente","SYNTHETIC-password-only");
  const b=createAccount("synthetic-generalist@example.invalid","generalista","SYNTHETIC-other-only");
  process.env.SESSION_SECRET="SYNTHETIC-session-key-never-a-real-secret";
  process.env.RH_ADMIN_ACCOUNTS=JSON.stringify([a,b]);
  const one=signSession(verifyLogin(a.email,"SYNTHETIC-password-only")),two=signSession(verifyLogin(b.email,"SYNTHETIC-other-only"));
  assert.equal(readSession(one).role,"gerente");revokeSession(one);assert.equal(readSession(one),null);
  assert.equal(readSession(two).role,"generalista");
  const rotated=signSession(verifyLogin(b.email,"SYNTHETIC-other-only"));
  process.env.RH_ADMIN_ACCOUNTS=JSON.stringify([a,{...b,hash:scryptSync("SYNTHETIC-rotated-only",b.salt,64).toString("hex")}]);
  assert.equal(readSession(rotated),null);assert.equal(readSession(two),null);
  process.env.RH_ADMIN_ACCOUNTS=JSON.stringify([a,{...a}]);assert.equal(adminConfigured(),false);
  process.env.RH_ADMIN_ACCOUNTS=JSON.stringify([a,b]);
  pass("Sesiones opacas: logout revoca copia, aislamiento de roles, cambio de credencial y configuración inválida");
  const expiring=signSession(verifyLogin(a.email,"SYNTHETIC-password-only")),realNow=Date.now;
  try{Date.now=()=>realNow()+8*3600000;assert.equal(readSession(expiring),null);}finally{Date.now=realNow;}
  assert.equal(readSession(expiring+"x"),null);
  const newProcess=await import("../src/lib/server/admin-auth.ts?synthetic-new-instance");
  assert.equal(newProcess.readSession(signSession(verifyLogin(a.email,"SYNTHETIC-password-only"))),null);
  pass("Caducidad exacta de sesión y proceso nuevo fallan cerrado");
  const json=(value,headers={})=>new Request("https://synthetic.invalid",{method:"POST",
    headers:{"content-type":"application/json",...headers},body:JSON.stringify(value)});
  assert(!sameOrigin(json({},{"origin":"null"})));
  assert(!sameOrigin(json({},{"origin":"https://synthetic.invalid","sec-fetch-site":"cross-site"})));
  assert(sameOrigin(json({},{"origin":"https://synthetic.invalid"})));
  await assert.rejects(readJsonObject(json({text:"x".repeat(20000)})));
  await assert.rejects(readJsonObject(json([])));await assert.rejects(readJsonObject(new Request("https://synthetic.invalid",{method:"POST",body:"{}"})));
  pass("CSRF, JSON estricto y límite de cuerpo sin lectura ilimitada");
  let now=Date.parse("2026-11-13T18:00:00Z"),calls=0;
  const job=(id,extra={})=>({id,appointmentId:"synthetic-appointment",ticketId:"synthetic-ticket",to:"000000000000001",
    scheduledAt:Date.parse("2026-11-12T20:00:00Z"),appointmentState:"REALIZADA",category:"Nómina y prestaciones",
    active:true,answered:false,state:"PENDIENTE",attempts:0,nextAt:now,...extra});
  const repo=new MemoryDeliveryRepository([job("one")]),messages=[];
  const transport={mode:"FAKE_ONLY",async send(message){calls++;messages.push(message);return {status:"ACCEPTED",messageId:"synthetic-outbound-receipt"};}};
  const options={now:()=>now,template:"synthetic_template",language:"es_MX"};
  await Promise.all(Array.from({length:20},()=>createSurveyDispatcher(repo,transport,options).run()));
  assert.equal(calls,1);assert.equal(repo.snapshot()[0].state,"ACEPTADA");assert.equal(messages[0].kind,"template");
  await createSurveyDispatcher(repo,transport,options).run();assert.equal(calls,1);
  pass("Scheduler ficticio concurrente: veinte invocaciones, un solo intento/recibo y replay sin envío");
  const boundaries=new MemoryDeliveryRepository([job("inside",{lastInboundAt:now-24*3600000+1}),
    job("boundary",{lastInboundAt:now-24*3600000}),job("future",{lastInboundAt:now+1})]);
  const modes=[];await createSurveyDispatcher(boundaries,{mode:"FAKE_ONLY",async send(m){modes.push(m.kind);return{status:"ACCEPTED",messageId:"synthetic"};}},options).run();
  assert.deepEqual(modes,["text","template","template"]);
  pass("Ventana Meta: 24h menos 1ms usa texto; 24h exactas/futuro usan plantilla");
  const retryRepo=new MemoryDeliveryRepository([job("retry")]);let rejected=0;
  const retry=createSurveyDispatcher(retryRepo,{mode:"FAKE_ONLY",async send(){return ++rejected===1?
    {status:"RETRYABLE",code:"429"}:{status:"ACCEPTED",messageId:"synthetic"};}},options);
  await retry.run();assert.equal(retryRepo.snapshot()[0].state,"REINTENTAR");
  await retry.run();assert.equal(rejected,1);now+=60000;await retry.run();assert.equal(rejected,2);
  assert.equal(retryRepo.snapshot()[0].state,"ACEPTADA");
  pass("429 explícitamente rechazado: backoff y reintento acotado sin duplicar aceptación");
  const unknownRepo=new MemoryDeliveryRepository([job("unknown")]);let unknownCalls=0;
  const uncertain=createSurveyDispatcher(unknownRepo,{mode:"FAKE_ONLY",async send(){unknownCalls++;throw new Error("synthetic-timeout");}},options);
  await uncertain.run();now+=3600000;await uncertain.run();assert.equal(unknownCalls,1);
  assert.equal(unknownRepo.snapshot()[0].state,"REVISION");
  const abandoned=new MemoryDeliveryRepository([job("abandoned")]),claim=await abandoned.claim(now);
  now+=60000;assert.equal(await abandoned.claim(now),null);assert.equal(abandoned.snapshot()[0].state,"REVISION");
  await assert.rejects(abandoned.settle("abandoned","wrong-token",{state:"ACEPTADA",code:"test"}));
  await abandoned.settle("abandoned",claim.token,{state:"ACEPTADA",code:"LATE_PROVIDER_ACK",providerId:"synthetic"});
  pass("Timeout/lease vencido: revisión sin reenvío ciego; fencing y acuse tardío controlados");
  const invalid=new MemoryDeliveryRepository([job("inactive",{active:false}),job("cancelled",{appointmentState:"CANCELADA"}),
    job("answered",{answered:true}),job("voice",{category:"Tu Voz en Trainmex"}),job("today",{scheduledAt:now}),
    job("real-shaped-number",{to:"525500000000"})]);
  let invalidCalls=0;await createSurveyDispatcher(invalid,{mode:"FAKE_ONLY",async send(){invalidCalls++;throw new Error();}},options).run();
  assert.equal(invalidCalls,0);assert(invalid.snapshot().every(j=>["REVISION","DESCARTADA"].includes(j.state)));
  pass("Elegibilidad: no inactivos, canceladas, respondidas, Tu Voz, mismo día ni destino enrutable");
  const budgetRepo=new MemoryDeliveryRepository([job("budget")]);let budgetCalls=0;
  const budget=createSurveyDispatcher(budgetRepo,{mode:"FAKE_ONLY",async send(){budgetCalls++;return{status:"RETRYABLE",code:"429"};}},options);
  for(let i=0;i<6;i++){await budget.run();now+=3600000;}assert.equal(budgetCalls,3);assert.equal(budgetRepo.snapshot()[0].state,"REVISION");
  pass("Presupuesto técnico de tres intentos: evita tormenta y conserva revisión pendiente");
  const cronKey="SYNTHETIC-cron-secret-only-for-local-tests";let prepared=false;
  const cron=createCronHandler({secret:()=>cronKey,prepare:async()=>({prepared:prepared?0:(prepared=true,1),outbound:false})});
  const cronRequest=(task,auth=cronKey)=>({request:json({task},{authorization:`Bearer ${auth}`})});
  assert.equal((await cron(cronRequest("prepare","wrong"))).status,401);
  assert.equal((await cron(cronRequest("dispatch"))).status,409);
  assert.equal((await (await cron(cronRequest("prepare"))).json()).prepared,1);
  assert.equal((await (await cron(cronRequest("prepare"))).json()).prepared,0);
  const broken=createCronHandler({secret:()=>cronKey,prepare:async()=>{throw new Error("synthetic-no-commit");}});
  assert.equal((await broken(cronRequest("prepare"))).status,503);
  pass("Cron autenticado: dedupe preparación, despacho bloqueado y fallo sin falso COMMIT");
  process.env.WHATSAPP_ACCESS_TOKEN="SYNTHETIC-not-a-real-token";process.env.WHATSAPP_PHONE_NUMBER_ID="0000000000000";
  process.env.WHATSAPP_OUTBOUND_ALLOWLIST="000000000000001";process.env.WHATSAPP_OUTBOUND_APPROVED="true";
  let graphCalls=0;
  const graph=async()=>{graphCalls++;return Response.json({messages:[{id:"synthetic"}]});};
  const text={to:"000000000000001",kind:"text",text:"Ficticio",lastInboundAt:Date.now()};
  assert.equal((await sendWhatsApp(text,null,graph)).status,"BLOCKED");assert.equal(graphCalls,0);
  assert.equal((await sendWhatsApp(text,{reviewed:true},graph)).status,"ACCEPTED");
  await assert.rejects(sendWhatsApp({...text,lastInboundAt:NaN},{reviewed:true},graph));
  await assert.rejects(sendWhatsApp(text,{reviewed:true},async()=>Response.json({}, {status:429})),e=>e instanceof OutboundFailure&&e.certainty==="RETRYABLE_REJECTED");
  await assert.rejects(sendWhatsApp(text,{reviewed:true},async()=>Response.json({}, {status:500})),e=>e.certainty==="UNKNOWN");
  await assert.rejects(sendWhatsApp(text,{reviewed:true},async()=>Response.json({})),e=>e.certainty==="UNKNOWN");
  pass("Transporte Graph sustituido: OFF aun con credenciales, ventana/recibo y errores explícitos");
  process.env.RH_EXPORT_SPREADSHEET_ID="synthetic-destination";
  const noPool={async connect(){throw new Error("Must not connect");}};
  await assert.rejects(exportMonth(noPool,"not-month"));
  for(const status of [401,403])await assert.rejects(inspectExportDestination(async()=>Response.json({}, {status})),e=>e.code==="SHEETS_PERMISSION_REQUIRED");
  await assert.rejects(inspectExportDestination(async()=>Response.json({}, {status:429})),e=>e.code==="SHEETS_RATE_LIMIT");
  assert.deepEqual(await inspectExportDestination(async()=>Response.json({})),{accessible:true,readOnly:true,writePermission:"NOT_PROVEN_WITHOUT_AUTHORIZED_WRITE"});
  let archives=0;
  const exportPool={async connect(){return{release(){},async query(q){
    if(q.startsWith("UPDATE public.tickets"))archives++;
    if(q.includes("pg_try_advisory_xact_lock"))return{rows:[{acquired:true}]};
    return{rows:q.includes("FROM public.tickets")?[{id_ticket:"1",categoria:"Nómina y prestaciones",
      subcategoria:"Pago semanal",centro:"SYNTHETIC",departamento:"SYNTHETIC",resumen:"SYNTHETIC",estado:"cerrado",cerrado_en:"2026-11-01T12:00:00Z"}]:[]};
  }};}};
  const conflictProxy=async(path)=>Response.json(path.includes("?fields=")?{sheets:[{properties:{title:"Tickets_2026_11",sheetId:1}}]}:{values:[["1"]]});
  await assert.rejects(exportMonth(exportPool,"2026-11",{proxy:conflictProxy}),e=>e.code==="SHEETS_TRACE_CONFLICT");
  assert.equal(archives,0);
  const trace=["1","Nómina y prestaciones","Pago semanal","SYNTHETIC","SYNTHETIC","SYNTHETIC","cerrado","2026-11-01T12:00:00.000Z"];
  await assert.rejects(exportMonth(exportPool,"2026-11",{proxy:async path=>Response.json(path.includes("?fields=")?
    {sheets:[{properties:{title:"Tickets_2026_11",sheetId:1}}]}:{values:[trace,trace]})}),e=>e.code==="SHEETS_TRACE_CONFLICT");
  const unverified=async(path)=>Response.json(path.includes("?fields=")?{sheets:[{properties:{title:"Tickets_2026_11",sheetId:1}}]}:{values:[]});
  await assert.rejects(exportMonth(exportPool,"2026-11",{proxy:unverified}),e=>e.code==="SHEETS_VERIFICATION_REQUIRED");
  assert.equal(archives,0);
  pass("Sheets: destino/permiso, lectura no prueba escritura y colisión de trazabilidad no archiva");
  const late=createSheetsFixture("Tickets_2026_11",{lateAckOnce:true});
  await assert.rejects(exportMonth(exportPool,"2026-11",{proxy:late.proxy}),e=>e.code==="SHEETS_CONNECTION_PENDING");
  await assert.rejects(exportMonth(exportPool,"2026-11",{proxy:late.proxy}),e=>e.code==="SHEETS_WRITE_UNCONFIRMED");
  assert.equal(archives,0);assert.equal(late.appends,1);
  const recoveredLate=await exportMonth(exportPool,"2026-11",{proxy:late.proxy});
  assert.equal(recoveredLate.archived,1);assert.equal(recoveredLate.appended,0);assert.equal(late.appends,1);
  pass("Sheets: efecto tardío tras timeout, barrera atómica de metadata y recuperación sin segunda fila");
  console.log(`PREACTIVACION LOCAL: ${groups} grupos PASS; sin llamadas de envío, SQL real ni Secrets del proyecto modificados.`);
}finally{for(const[k,v]of before)if(v===undefined)delete process.env[k];else process.env[k]=v;}
