import assert from "node:assert/strict";
import {randomUUID,createHmac,createHash} from "node:crypto";
import {spawn} from "node:child_process";
import pg from "pg";
import {neonPoolOptions,neonTlsVerified} from "../src/lib/server/postgres-config.ts";
import {createCronHandler} from "../src/lib/server/cron-handler.ts";
import {exportMonth} from "../src/lib/server/monthly-export.ts";
import {createSheetsFixture} from "./helpers/sheets-fixture.mjs";
import {createDurableConversation} from "../src/lib/server/durable-conversation.ts";
import {createNeonTicketRepository} from "../src/lib/server/payroll-tickets.ts";
import {createNeonAgendaRepository} from "../src/lib/server/neon-agenda.ts";
import {createWebhookPost} from "../src/lib/server/whatsapp-webhook-post.ts";
import {readRH,writeRH,prepareSurveys} from "../src/lib/server/rh-service.ts";
import {postLockBoundary} from "./fixtures/neon-c3-safety.mjs";
import {localDate,plusDays} from "../src/lib/server/agenda-time.ts";

const pools=[];
const pool=()=>{const p=new pg.Pool(neonPoolOptions());pools.push(p);return p;};
async function deps(p,owner){
  const services=(await p.query("SELECT id_servicio::text,categoria,subcategoria FROM public.servicios WHERE activo IS TRUE ORDER BY categoria,subcategoria")).rows.map(r=>({idServicio:r.id_servicio,categoria:r.categoria,subcategoria:r.subcategoria}));
  return {services,lookupIdentity:async phone=>{
    const rows=(await p.query("SELECT id_colaborador,activo FROM public.colaboradores WHERE whatsapp=$1",[phone])).rows;
    return rows.length===1&&rows[0].activo?{status:"active",id:rows[0].id_colaborador}:{status:rows.length?"inactive":"not_found",id:null};
  },listActiveServices:async()=>services,classifyService:async text=>{
    const s=text.toLowerCase();
    const chosen=services.find(x=>s.includes("vacacion")?x.subcategoria==="Vacaciones":
      s.includes("idea")?x.subcategoria==="Ideas y mejoras":
      s.includes("queja")?x.subcategoria==="Quejas y denuncias":
      x.categoria==="Nómina y prestaciones"&&x.subcategoria==="Pago semanal");
    return {serviceId:chosen?.idServicio??null,classification:chosen?"clasificado":"sin clasificar"};
  }};
}
if(process.argv.includes("--child")){
  let input="";for await(const x of process.stdin)input+=x;
  try{const args=JSON.parse(input),p=pool(),d=await deps(p,args.owner);
    const r=await createDurableConversation(d,p).handleMessage(args.phone,args.text,args.key);
    process.stdout.write(JSON.stringify(r));}
  catch{process.exitCode=1;}finally{await Promise.all(pools.map(p=>p.end()));}
}else{
  const p=pool(),p2=pool(),owner="SYNTHETIC-INTEGRAL-"+randomUUID(),phone="000000000000001",prefix="synthetic-integral-"+randomUUID();
  const observer=await p.connect();
  let baseline,tables,created=false,passed=0;
  const snapshot=async()=>{
    const result={};
    for(const t of tables)result[t]=(await observer.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(r)::text,'|' ORDER BY to_jsonb(r)::text),'')) AS fingerprint FROM public.${t} r`)).rows[0];
    return result;
  };
  const pass=name=>{passed++;console.log(name+": PASS");};
  let seq=0;
  const key=()=>prefix+"-"+(++seq);
  const child=async(input)=>{
    const c=spawn(process.execPath,["scripts/test-integral-neon.mjs","--child"],{stdio:["pipe","pipe","pipe"],env:process.env});
    let out="";c.stdout.on("data",x=>out+=x);c.stderr.resume();const timer=setTimeout(()=>c.kill(),60000);
    c.stdin.end(JSON.stringify({owner,phone,...input}));
    const code=await new Promise(r=>c.on("close",r));clearTimeout(timer);assert.equal(code,0);return JSON.parse(out);
  };
  let initialSequences;
  try{
    tables=(await observer.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
    assert.equal(tables.length,14);assert(tables.includes("contextos_conversacion")&&tables.includes("eventos_entrantes"));
    const fks=(await observer.query(`SELECT conrelid::regclass::text AS source,confrelid::regclass::text AS target,
      convalidated FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f'`)).rows;
    assert(fks.every(f=>f.convalidated&&tables.includes(f.source)&&tables.includes(f.target)));
    baseline=await snapshot();assert.equal(baseline.servicios.count,15);assert.equal(baseline.horarios_atencion.count,5);
    for(const t of tables.filter(t=>!["servicios","horarios_atencion"].includes(t)))assert.equal(baseline[t].count,0,"Requires isolated operational baseline");
    initialSequences=(await observer.query("SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
    console.log(JSON.stringify({phase:"baseline",fingerprint:createHash("sha256").update(JSON.stringify(baseline)).digest("hex"),
      counts:Object.fromEntries(tables.map(t=>[t,baseline[t].count]))}));
    assert(neonTlsVerified(observer));console.log("TLS Neon verify-full: socket del cliente cifrado y certificado verificado: PASS.");
    if(!process.argv.includes("--authorized-synthetic-commit")){
      console.log("PREFLIGHT READ-ONLY: PASS. No fixtures creados. COMMIT sintético requiere autorización vigente y --authorized-synthetic-commit.");
    }else{
    // Only one synthetic directory fixture, impossible outbound destination; existing catalog READ ONLY.
    created=true;
    await writeRH(p,"colaboradores","save",{id_colaborador:owner,nombre:"SYNTHETIC INTEGRATION TEST",
      whatsapp:phone,centro:"SYNTHETIC",departamento:"SYNTHETIC",puesto:"SYNTHETIC",activo:true},"generalista");
    const d=await deps(p,owner),m=createDurableConversation(d,p);
    const send=(text,k=key())=>m.handleMessage(phone,text,k);
    const hello=key(),greeting=await send("hola",hello);assert.match(greeting.reply,/Catarina/);
    const time=(await observer.query("SELECT ultimo_evento_nuevo_en FROM public.contextos_conversacion WHERE id_colaborador=$1",[owner])).rows[0].ultimo_evento_nuevo_en;
    assert.equal((await child({text:"hola",key:hello})).action,"durable_replay");
    assert.equal((await observer.query("SELECT ultimo_evento_nuevo_en FROM public.contextos_conversacion WHERE id_colaborador=$1",[owner])).rows[0].ultimo_evento_nuevo_en.getTime(),time.getTime());
    await assert.rejects(send("contenido diferente",hello),e=>e.code==="EVENT_CONFLICT");
    pass("Evento sin efecto durable, proceso nuevo, conflicto y TTL sin renovación");
    await send("1");await send("Pago semanal");await child({text:"13/11/2026",key:key()});
    await send("No recibí el pago semanal sintético de prueba.");
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.tickets WHERE id_colaborador=$1",[owner])).rows[0].n,0);
    const confirmation=key(),ticketReply=await send("confirmo",confirmation);assert.equal(ticketReply.action,"payroll_ticket_created");
    const ticket=(await observer.query("SELECT id_ticket::text,resuelto_en FROM public.tickets WHERE id_colaborador=$1",[owner])).rows[0];
    assert.equal(ticket.resuelto_en,null);
    await child({text:"confirmo",key:confirmation});
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.tickets WHERE id_colaborador=$1",[owner])).rows[0].n,1);
    pass("Nómina completa, borrador entre procesos, confirmación y folio únicos con COMMIT");
    assert.equal((await send("sí")).action,"agenda_options");
    await send("1");const booking=key();assert.equal((await child({text:"confirmo",key:booking})).action,"agenda_registered");
    const appointment=(await observer.query("SELECT id_cita::text,inicio_programado,fin_programado FROM public.citas WHERE id_ticket=$1",[ticket.id_ticket])).rows[0];
    await child({text:"confirmo",key:booking});
    await send("reprogramar cita "+appointment.id_cita);await send("confirmo");await send("2");
    const moving=key();await child({text:"confirmo",key:moving});
    const moved=(await observer.query("SELECT id_cita::text,inicio_programado FROM public.citas WHERE id_ticket=$1",[ticket.id_ticket])).rows[0];
    assert.equal(moved.id_cita,appointment.id_cita);assert.notEqual(moved.inicio_programado.getTime(),appointment.inicio_programado.getTime());
    await child({text:"confirmo",key:booking});assert.equal((await observer.query("SELECT inicio_programado FROM public.citas WHERE id_cita=$1",[appointment.id_cita])).rows[0].inicio_programado.getTime(),moved.inicio_programado.getTime());
    await send("cancelar cita "+appointment.id_cita);await send("confirmo");
    assert.equal((await observer.query("SELECT estado FROM public.citas WHERE id_cita=$1",[appointment.id_cita])).rows[0].estado,"CANCELADA");
    assert.equal((await observer.query("SELECT resuelto_en FROM public.tickets WHERE id_ticket=$1",[ticket.id_ticket])).rows[0].resuelto_en,null);
    await send("no deseo agendar");
    const closed=(await observer.query("SELECT estado,resuelto_en FROM public.tickets WHERE id_ticket=$1",[ticket.id_ticket])).rows[0];
    assert.equal(closed.estado,"cerrado sin cita");assert.equal(closed.resuelto_en,null);
    pass("Cita presencial, reprogramación mismo ID, cancelación y replay antiguo sin mutación");
    await send("menú principal");await send("2");await send("¿Qué requisitos hay para solicitar vacaciones?");
    const policy=await send("confirmo");assert.equal(policy.action,"policy_ticket");
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.consultas WHERE id_colaborador=$1 AND resultado='documentacion faltante'",[owner])).rows[0].n,1);
    assert.equal((await send("sí")).action,"remote_options");await send("1");const remoteReply=await send("confirmo");assert.equal(remoteReply.action,"remote_registered");
    const remote=(await observer.query("SELECT a.* FROM public.citas a JOIN public.tickets t USING(id_ticket) WHERE t.id_colaborador=$1 AND a.modalidad='REMOTA'",[owner])).rows[0];
    assert(remote);pass("Políticas sin fuente, indicador y ticket confirmados, agenda REMOTA compartida");
    await send("menú principal");await send("3");await send("Ideas y mejoras");
    await send("Idea sintética para mejorar la señalización del área de prueba.");await send("confirmo");const voiceId=key();
    assert.equal((await send("no",voiceId)).action,"voice_registered");
    await child({text:"no",key:voiceId});
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.denuncias WHERE id_colaborador=$1",[owner])).rows[0].n,1);
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.tickets WHERE id_colaborador=$1",[owner])).rows[0].n,2);
    pass("Tu Voz separada, consentimiento No anotado, sin ticket/cita/seguimiento adicionales");
    await observer.query(`WITH instant AS(SELECT clock_timestamp() t)
      UPDATE public.contextos_conversacion SET ultimo_evento_nuevo_en=instant.t-interval '121 minutes',
      vence_en=instant.t-interval '1 minute' FROM instant WHERE id_colaborador=$1`,[owner]);
    await send("confirmo");assert.equal((await observer.query("SELECT count(*)::int n FROM public.tickets WHERE id_colaborador=$1",[owner])).rows[0].n,2);
    pass("Contexto vencido no convierte confirmo aislado en un registro");
    await observer.query("UPDATE public.colaboradores SET activo=false WHERE id_colaborador=$1",[owner]);
    const beforeDenied=(await observer.query("SELECT count(*)::int n FROM public.eventos_entrantes")).rows[0].n;
    assert.equal((await send("hola")).action,"access_denied");assert.equal((await m.handleMessage("000000000009999","hola",key())).action,"access_denied");
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.eventos_entrantes")).rows[0].n,beforeDenied);
    await observer.query("UPDATE public.colaboradores SET activo=true WHERE id_colaborador=$1",[owner]);
    pass("Número no autorizado/inactivo sin escrituras de negocio ni diario");
    const staleIdentityKey=key();
    const staleIdentity=createDurableConversation({...d,lookupIdentity:async()=>{
      const result=await d.lookupIdentity(phone);
      await observer.query("UPDATE public.colaboradores SET whatsapp='000000000000004' WHERE id_colaborador=$1",[owner]);
      return result;
    }},p);
    try{await assert.rejects(staleIdentity.handleMessage(phone,"confirmo",staleIdentityKey),e=>e.code==="ACCESS_DENIED");}
    finally{await observer.query("UPDATE public.colaboradores SET whatsapp=$2 WHERE id_colaborador=$1",[owner,phone]);}
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.eventos_entrantes WHERE id_evento_meta=$1",[staleIdentityKey])).rows[0].n,0);
    pass("Cambio de titularidad WhatsApp entre lectura y transacción se rechaza sin efectos");
    await send("menú principal");
    const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
    let entered=deferred(),release=deferred();
    const slow=createDurableConversation({...d,classifyService:async(...args)=>{
      assert.equal(p.totalCount-p.idleCount,1,"Only observer connection remains acquired outside AI");
      entered.resolve();await release.promise;return d.classifyService(...args);
    }},p);
    const pendingKey=key(),pending=slow.handleMessage(phone,"Consulta sintética sobre pago semanal.",pendingKey);
    await entered.promise;
    await assert.rejects(send("hola"),e=>e.code==="CONVERSATION_BUSY");
    release.resolve();await pending;
    pass("Lease PostgreSQL impide dos mensajes simultáneos sobre el mismo borrador");
    await send("menú principal");entered=deferred();release=deferred();
    const staleKey=key(),stale=slow.handleMessage(phone,"Consulta sintética de pago semanal.",staleKey);
    const caught=stale.catch(e=>e);await entered.promise;
    await observer.query("UPDATE public.contextos_conversacion SET lease_hasta=clock_timestamp()-interval '1 second' WHERE id_colaborador=$1",[owner]);
    await send("hola");release.resolve();assert.equal((await caught).code,"LEASE_FENCED");
    assert.equal((await send("Consulta sintética de pago semanal.",staleKey)).action,"durable_replay");
    assert.equal((await observer.query("SELECT resultado_minimo->>'codigo' AS code FROM public.eventos_entrantes WHERE id_evento_meta=$1",[staleKey])).rows[0].code,"STALE_PENDING_DISCARDED");
    pass("Fencing de lease vencido y reintento pendiente viejo sin confirmar borrador nuevo");
    const tr=createNeonTicketRepository(p),ar=createNeonAgendaRepository(p,{mode:"SIMULATION_ONLY"}),ar2=createNeonAgendaRepository(p2,{mode:"SIMULATION_ONLY"});
    const createTicket=()=>tr.createConfirmed({collaboratorId:owner,serviceId:d.services.find(x=>x.subcategoria==="Pago semanal").idServicio,description:"SYNTHETIC",summary:"SYNTHETIC",confirmationId:key()});
    const t1=await createTicket(),t2=await createTicket();
    const date=plusDays(localDate(Date.now()),3),available=[];
    for(let i=0;i<7&&!available.length;i++)available.push(...await ar.listAvailable({ticketId:t1.id,collaboratorId:owner,date:plusDays(date,i),modality:"PRESENCIAL"}));
    assert(available.length>=3);
    const command=(t,start,k=key(),modality="PRESENCIAL")=>({ticketId:t.id,collaboratorId:owner,start,eventId:k,operation:"RESERVAR",modality,confirmed:true});
    const results=await Promise.allSettled([ar.execute(command(t1,available[0])),ar2.execute(command(t2,available[0],key(),"REMOTA"))]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    const winner=results[0].status==="fulfilled"?t1:t2,loser=winner===t1?t2:t1;
    await assert.rejects(ar2.execute(command(loser,new Date(Date.parse(available[0])+10*60000).toISOString())));
    await ar2.execute(command(loser,available[1]));
    pass("Dos conexiones concurrentes: solo una reserva idéntica, parcial rechazada, adyacente válida");
    const a1=(await ar.forOwner(owner)).find(a=>a.ticketId===winner.id);
    const original=a1.start;
    await assert.rejects(ar.execute({...command(winner,available[1]),operation:"REPROGRAMAR",appointmentId:a1.id}));
    assert.equal((await ar.findAppointment(a1.id,winner.id,owner)).start,original);
    pass("Reprogramación fallida conserva reserva y no produce recibo aplicado");
    await postLockBoundary(observer,p,p2);pass("Reloj PostgreSQL post-lock: frontera inclusiva 120:00 frente a 119:59");
    await assert.rejects(writeRH(p,"citas","attendance",{id_cita:remote.id_cita,estado:"REALIZADA"},"generalista"),e=>e.code==="APPOINTMENT_NOT_ENDED");
    // Only our uniquely identified synthetic appointment is backdated for next-day survey checks.
    await observer.query("UPDATE public.citas SET inicio_programado=$2::timestamptz,fin_programado=$2::timestamptz+interval '20 minutes' WHERE id_cita=$1 AND id_ticket=$3",[remote.id_cita,new Date(Date.now()-3*86400000).toISOString(),remote.id_ticket]);
    await writeRH(p,"citas","attendance",{id_cita:remote.id_cita,estado:"NO_ASISTIO",observaciones:"SYNTHETIC"},"generalista");
    const survey1=await prepareSurveys(p),survey2=await prepareSurveys(p2);assert([0,1].includes(survey1.prepared));assert.equal(survey2.prepared,0);
    const survey=(await observer.query("SELECT id_encuesta::text FROM public.encuestas WHERE id_cita=$1",[remote.id_cita])).rows[0];
    await send("encuesta");await child({text:"no",key:key()});await send("sin comentario");
    const answered=(await observer.query("SELECT recibio_atencion,calificacion,resolucion FROM public.encuestas WHERE id_encuesta=$1",[survey.id_encuesta])).rows[0];
    assert.deepEqual(answered,{recibio_atencion:false,calificacion:null,resolucion:null});
    pass("Atención administrativa posterior, encuesta única al día siguiente y no atención ≠ no resuelto");
    await assert.rejects(readRH(p,"voz","generalista"),e=>e.code==="ACCESS_DENIED");
    const protectedRows=await readRH(p,"voz","gerente");assert.equal(protectedRows.length,1);
    pass("Permisos mínimos del panel: Tu Voz denegada a Generalista");
    await send("menú principal");await send("1");await send("Pago semanal");await send("13/11/2026");
    await send("Aclaración de pago semanal completamente sintética para probar rollback.");
    const beforeRollback=(await observer.query("SELECT count(*)::int n FROM public.tickets WHERE id_colaborador=$1",[owner])).rows[0].n;
    const atomicKey=key();let fail=true;
    const faultPool={
      query:(...args)=>p.query(...args),
      async connect(){const c=await p.connect();return {
        async query(sql,params){
          if(fail&&sql.includes("UPDATE public.eventos_entrantes SET estado_tecnico='PROCESADO'")){
            fail=false;throw new Error("SYNTHETIC_BEFORE_FINAL_LEDGER");
          }return c.query(sql,params);
        },release:destroy=>c.release(destroy)
      };}
    };
    await assert.rejects(createDurableConversation(d,faultPool).handleMessage(phone,"confirmo",atomicKey));
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.tickets WHERE id_colaborador=$1",[owner])).rows[0].n,beforeRollback);
    assert.equal((await observer.query("SELECT estado_tecnico FROM public.eventos_entrantes WHERE id_evento_meta=$1",[atomicKey])).rows[0].estado_tecnico,"PENDIENTE");
    pass("Una conexión: fallo posterior al ticket revierte negocio/contexto/recibo final juntos");
    let commits=0;
    const lostPool={
      query:(...args)=>p.query(...args),
      async connect(){const c=await p.connect();return {
        async query(sql,params){const r=await c.query(sql,params);if(sql==="COMMIT"&&++commits===2)throw new Error("SYNTHETIC_LOST_ACK");return r;},
        release:destroy=>c.release(destroy)
      };}
    };
    await assert.rejects(createDurableConversation(d,lostPool).handleMessage(phone,"confirmo",atomicKey),e=>e.code==="COMMIT_OUTCOME_UNKNOWN");
    assert.equal((await child({text:"confirmo",key:atomicKey})).action,"durable_replay");
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.tickets WHERE id_colaborador=$1",[owner])).rows[0].n,beforeRollback+1);
    pass("Acuse perdido después de COMMIT real, proceso nuevo recupera un solo folio");
    const source=await writeRH(p,"fuentes","save",{nombre:prefix,categoria:"Vacaciones",
      url_drive:"https://docs.google.com/document/d/synthetic-test-document-not-real",version:"SYNTHETIC",
      vigente_desde:"2026-01-01",activo:false},"gerente");
    assert(source.id_fuente);
    const blockDate=plusDays(localDate(Date.now()),20);
    const block=await writeRH(p,"bloqueos","save",{fecha:blockDate,hora_inicio:"15:00",hora_fin:"15:10",motivo:prefix},"generalista");
    assert(block.id_bloqueo);
    const blocked=await ar.listAvailable({ticketId:t1.id,collaboratorId:owner,date:blockDate,modality:"PRESENCIAL"});
    const {mexicoInstant}=await import("../src/lib/server/agenda-time.ts");
    assert(!blocked.includes(new Date(mexicoInstant(blockDate,"15:00")).toISOString()));
    const editedBlock=await writeRH(p,"bloqueos","save",{id_bloqueo:String(block.id_bloqueo),fecha:blockDate,
      hora_inicio:"15:20",hora_fin:"15:30",motivo:prefix},"generalista");
    assert.equal(String(editedBlock.id_bloqueo),String(block.id_bloqueo));
    const editedSlots=await ar.listAvailable({ticketId:t1.id,collaboratorId:owner,date:blockDate,modality:"PRESENCIAL"});
    assert(editedSlots.includes(new Date(mexicoInstant(blockDate,"15:00")).toISOString()));
    assert(!editedSlots.includes(new Date(mexicoInstant(blockDate,"15:20")).toISOString()));
    await writeRH(p,"bloqueos","delete",{id_bloqueo:String(block.id_bloqueo)},"generalista");
    pass("Panel SQL real: directorio, fuente inactiva ficticia y bloqueo parcial editable");
    await assert.rejects(writeRH(p,"fuentes","save",{nombre:"denied"},"generalista"),e=>e.code==="ACCESS_DENIED");
    await assert.rejects(writeRH(p,"servicios","save",{id_servicio:"1",activo:false},"generalista"),e=>e.code==="ACCESS_DENIED");
    pass("Privilegios mínimos: Generalista no modifica fuentes oficiales ni catálogo");
    const due=(await observer.query(`SELECT a.id_cita::text FROM public.citas a JOIN public.tickets t USING(id_ticket)
      WHERE t.id_colaborador=$1 AND a.estado='PROGRAMADA' ORDER BY a.id_cita DESC LIMIT 1`,[owner])).rows[0];
    const yesterday=(await observer.query("SELECT to_char((clock_timestamp() AT TIME ZONE 'America/Mexico_City')-interval '1 day','YYYY-MM-DD') AS date")).rows[0].date;
    const movedDue=await observer.query(`UPDATE public.citas SET inicio_programado=$2,fin_programado=$3 WHERE id_cita=$1
      AND id_ticket IN(SELECT id_ticket FROM public.tickets WHERE id_colaborador=$4)`,
      [due.id_cita,new Date(mexicoInstant(yesterday,"14:20")).toISOString(),new Date(mexicoInstant(yesterday,"14:40")).toISOString(),owner]);
    assert.equal(movedDue.rowCount,1);
    const cronSecret="synthetic-cron-authorization-private-only";
    const cronFor=pool=>createCronHandler({secret:()=>cronSecret,prepare:()=>prepareSurveys(pool)});
    const cronRequest=()=>({request:new Request("https://synthetic.invalid/api/cron",{method:"POST",
      headers:{authorization:`Bearer ${cronSecret}`,"content-type":"application/json"},body:JSON.stringify({task:"prepare"})})});
    const cronResults=await Promise.all([cronFor(p)(cronRequest()),cronFor(p2)(cronRequest())]);
    assert(cronResults.every(r=>r.status===200));
    const cronBodies=await Promise.all(cronResults.map(r=>r.json()));assert(cronBodies.every(r=>r.committed&&r.outbound==="OFF"));
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.encuestas WHERE id_cita=$1",[due.id_cita])).rows[0].n,1);
    assert.equal((await observer.query("SELECT enviada_en FROM public.encuestas WHERE id_cita=$1",[due.id_cita])).rows[0].enviada_en,null);
    assert.equal((await observer.query("SELECT estado FROM public.citas WHERE id_cita=$1",[due.id_cita])).rows[0].estado,"PROGRAMADA");
    pass("Cron autenticado concurrente con SQL/COMMIT real: una encuesta, sin envío ni inferir atención");
    await send("encuesta");await child({text:"si",key:key()});await send("4");
    await child({text:"Parcialmente",key:key()});await send("sin comentario");
    const attendedSurvey=(await observer.query("SELECT recibio_atencion,calificacion,resolucion FROM public.encuestas WHERE id_cita=$1",[due.id_cita])).rows[0];
    assert.deepEqual(attendedSurvey,{recibio_atencion:true,calificacion:4,resolucion:"Parcialmente"});
    const unresolved=(await observer.query("SELECT t.resuelto_en,a.estado FROM public.citas a JOIN public.tickets t USING(id_ticket) WHERE a.id_cita=$1",[due.id_cita])).rows[0];
    assert.equal(unresolved.resuelto_en,null);assert.equal(unresolved.estado,"PROGRAMADA");
    pass("Encuesta SQL entre procesos: atención Sí, satisfacción 4 y resolución Parcialmente sin alterar ticket/cita");
    const priorTarget=process.env.RH_EXPORT_SPREADSHEET_ID;
    try{
      process.env.RH_EXPORT_SPREADSHEET_ID="synthetic-sheet-no-external-call";
      const month=(await observer.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'America/Mexico_City','YYYY-MM') AS month")).rows[0].month;
      const sheetTitle=`Tickets_${month.replace("-","_")}`;
      const sheets=createSheetsFixture(sheetTitle),proxy=sheets.proxy,sheetRows=sheets.rows;
      const exports=await Promise.allSettled([exportMonth(p,month,{proxy}),exportMonth(p2,month,{proxy})]);
      assert(exports.some(r=>r.status==="fulfilled"&&r.value.appended===1));
      assert(exports.filter(r=>r.status==="rejected").every(r=>r.reason.code==="PERSISTENCE_BUSY"));
      assert.equal((await exportMonth(p,month,{proxy})).appended,0);assert.equal(sheets.appends,1);
      assert.equal(sheetRows.length,2);assert.equal(sheetRows[1].length,10);
      const archived=(await observer.query("SELECT archivado_en,resuelto_en FROM public.tickets WHERE id_ticket=$1",[ticket.id_ticket])).rows[0];
      assert(archived.archivado_en);assert.equal(archived.resuelto_en,null);
    }finally{if(priorTarget===undefined)delete process.env.RH_EXPORT_SPREADSHEET_ID;else process.env.RH_EXPORT_SPREADSHEET_ID=priorTarget;}
    pass("Exportación: locks/archivado SQL real y Sheets ficticio concurrente, huella por ticket, sin duplicar/borrar");
    const appSecret="synthetic-signature-secret",manager=()=>createDurableConversation(d,p);
    const post=createWebhookPost(manager,{secret:()=>appSecret,logger:{info(){},error(){}}});
    const signed=async(messages,valid=true)=>{
      const body=JSON.stringify({object:"whatsapp_business_account",entry:[{changes:[{field:"messages",value:{messages}}]}]});
      return post({request:new Request("https://synthetic.invalid/api/whatsapp/webhook",{method:"POST",body,headers:{"x-hub-signature-256":"sha256="+createHmac("sha256",valid?appSecret:"wrong").update(body).digest("hex")}})});
    };
    const msg=(text,id=key())=>({type:"text",from:phone,id,text:{body:text}});
    const beforeHmac=(await observer.query("SELECT count(*)::int n FROM public.eventos_entrantes")).rows[0].n;
    assert.equal((await signed([msg("hola")],false)).status,401);
    assert.equal((await signed([msg("hola"),{type:"text",id:key()}])).status,400);
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.eventos_entrantes")).rows[0].n,beforeHmac);
    assert.equal((await signed([msg("hola"),msg("menú principal")])).status,200);
    const failing=createWebhookPost(()=>({handleMessage:async(...args)=>{if(args[1]==="synthetic-failure")throw new Error("injected");return manager().handleMessage(...args);}}),{secret:()=>appSecret,logger:{info(){},error(){}}});
    const batch=[msg("hola"),msg("synthetic-failure"),msg("menú principal")];
    const raw=JSON.stringify({object:"whatsapp_business_account",entry:[{changes:[{field:"messages",value:{messages:batch}}]}]});
    const headers={"x-hub-signature-256":"sha256="+createHmac("sha256",appSecret).update(raw).digest("hex")};
    assert.equal((await failing({request:new Request("https://synthetic.invalid",{method:"POST",body:raw,headers})})).status,503);
    assert.equal((await signed(batch)).status,200);
    pass("HMAC RAW y lote inválido sin efectos, lote parcial 503 y reentrega durable");
    const mediaKey=key(),media={type:"image",from:phone,id:mediaKey,image:{id:"synthetic-media-no-download"}};
    const beforeMedia=(await observer.query("SELECT estado FROM public.contextos_conversacion WHERE id_colaborador=$1",[owner])).rows[0].estado;
    assert.equal((await signed([media])).status,200);
    const afterMedia=(await observer.query("SELECT estado,ultimo_evento_nuevo_en::text AS activity FROM public.contextos_conversacion WHERE id_colaborador=$1",[owner])).rows[0];
    assert.deepEqual(afterMedia.estado,beforeMedia);
    assert.equal((await signed([{image:media.image,id:media.id,from:media.from,type:media.type}])).status,200);
    assert.equal((await observer.query("SELECT ultimo_evento_nuevo_en::text AS activity FROM public.contextos_conversacion WHERE id_colaborador=$1",[owner])).rows[0].activity,afterMedia.activity);
    assert.equal((await signed([{...media,image:{id:"synthetic-conflict"}}])).status,503);
    assert.equal((await observer.query("SELECT count(*)::int n FROM public.eventos_entrantes WHERE id_evento_meta=$1",[mediaKey])).rows[0].n,1);
    pass("Evento no textual: hash canónico, deduplicación durable, borrador intacto, sin descargar medios");
    }
  }catch(e){
    console.log("INTEGRAL_NEON_FAIL",{code:e.code??e.name,group:passed+1});
    process.exitCode=1;
  }finally{
    if(created){
      try{
        await observer.query("BEGIN");await observer.query("SET LOCAL lock_timeout='5s'");
        await observer.query("SELECT pg_advisory_xact_lock(2026111001)");
        const ticketIds=(await observer.query("SELECT id_ticket::text FROM public.tickets WHERE id_colaborador=$1",[owner])).rows.map(r=>r.id_ticket);
        const citeIds=(await observer.query("SELECT id_cita::text FROM public.citas WHERE id_ticket=ANY($1::bigint[])",[ticketIds])).rows.map(r=>r.id_cita);
        // No broad cleanup: all predicates bind the one fixture owner or captured dependency IDs.
        const removed={};
        removed.eventos=(await observer.query("DELETE FROM public.eventos_entrantes WHERE id_colaborador=$1",[owner])).rowCount;
        removed.contextos=(await observer.query("DELETE FROM public.contextos_conversacion WHERE id_colaborador=$1",[owner])).rowCount;
        removed.encuestas=(await observer.query("DELETE FROM public.encuestas WHERE id_cita=ANY($1::bigint[])",[citeIds])).rowCount;
        removed.consultas=(await observer.query("DELETE FROM public.consultas WHERE id_colaborador=$1",[owner])).rowCount;
        removed.recibos=(await observer.query("DELETE FROM public.operaciones_citas WHERE id_ticket=ANY($1::bigint[])",[ticketIds])).rowCount;
        removed.citas=(await observer.query("DELETE FROM public.citas WHERE id_cita=ANY($1::bigint[])",[citeIds])).rowCount;
        removed.tickets=(await observer.query("DELETE FROM public.tickets WHERE id_ticket=ANY($1::bigint[]) AND id_colaborador=$2",[ticketIds,owner])).rowCount;
        removed.voz=(await observer.query("DELETE FROM public.denuncias WHERE id_colaborador=$1",[owner])).rowCount;
        removed.fuentes=(await observer.query("DELETE FROM public.fuentes WHERE nombre=$1 AND version='SYNTHETIC' AND activo IS FALSE",[prefix])).rowCount;
        removed.bloqueos=(await observer.query("DELETE FROM public.bloqueos_agenda WHERE motivo=$1",[prefix])).rowCount;
        removed.colaboradores=(await observer.query("DELETE FROM public.colaboradores WHERE id_colaborador=$1 AND nombre='SYNTHETIC INTEGRATION TEST'",[owner])).rowCount;
        assert.equal(removed.colaboradores,1);await observer.query("COMMIT");
        const after=await snapshot();assert.deepEqual(after,baseline);
        const remainingLocks=(await observer.query("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=2026111002 AND objsubid=1 AND granted")).rows[0].n;
        assert.equal(remainingLocks,0);
        console.log(JSON.stringify({phase:"cleanup",removed,all14FingerprintsEqual:true,remainingExportLocks:remainingLocks,
          fingerprint:createHash("sha256").update(JSON.stringify(after)).digest("hex"),
          counts:Object.fromEntries(tables.map(t=>[t,after[t].count])),
          sequencesBefore:initialSequences,sequencesAfter:(await observer.query("SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows}));
      }catch{await observer.query("ROLLBACK").catch(()=>{});console.log("CLEANUP_REQUIRES_ATTENTION");process.exitCode=1;}
    }
    observer.release();await Promise.all(pools.map(p=>p.end()));
  }
  if(!process.exitCode&&passed)console.log(`INTEGRAL NEON: ${passed} grupos PASS; COMMIT temporal, SQL real, procesos nuevos, limpieza verificada; sin Meta real ni envíos.`);
}
