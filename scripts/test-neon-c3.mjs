import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { createNeonTicketRepository } from "../src/lib/server/payroll-tickets.ts";
import { createNeonAgendaRepository } from "../src/lib/server/neon-agenda.ts";
import { AGENDA_LOCK_KEY } from "../src/lib/server/persistence-unit.ts";
import { localDate, plusDays, mexicoInstant } from "../src/lib/server/agenda-time.ts";
import { tables, inspect, snapshot, counts, sequences, locked, clean, digest, postLockBoundary } from "./fixtures/neon-c3-safety.mjs";

// NEVER loaded by the application. Default is SELECT only; COMMIT needs opt-in.
// Logs contain test names/counts/codes only, not parameters, rows or pg messages.
const pools = [];
const sqlCounts = {};
function pool() {
  const p = new pg.Pool({connectionString:process.env.DATABASE_URL,
    connectionTimeoutMillis:10000,max:1,idleTimeoutMillis:5000});
  pools.push(p);
  return p;
}
function wrapped(p, hooks = {}) {
  return {async connect() {
    const c = await p.connect();
    return {
      async query(sql, params) {
        const verb = sql.trim().split(/\s/)[0];
        sqlCounts[verb]=(sqlCounts[verb]??0)+1;
        await hooks.before?.(sql,c,params);
        const r = await c.query(sql,params);
        await hooks.after?.(sql,c,params,r);
        return r;
      },
      release(destroy) {c.release(destroy);}
    };
  }};
}
const agenda = p => createNeonAgendaRepository(p,{mode:"SIMULATION_ONLY"});
const ticketRepo = p => createNeonTicketRepository(p);
const deferred = () => {let resolve; const promise = new Promise(r => {resolve=r;});return {promise,resolve};};
const rejects = (fn,code) => assert.rejects(fn,e=>e.code===code);
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function observeWait(observer,pid) {
  for(let i=0;i<40;i++){
    const r=(await observer.query(`SELECT cardinality(pg_blocking_pids($1)) AS n`,[pid])).rows[0];
    if(r.n>0) return;
    await pause(40);
  }
  throw Object.assign(new Error("Expected actual database lock wait"),{code:"LOCK_WAIT_NOT_OBSERVED"});
}
async function childRecover(input) {
  const child=spawn(process.execPath,["scripts/test-neon-c3.mjs","--recover-child"],{
    cwd:process.cwd(),env:process.env,stdio:["pipe","pipe","pipe"]
  });
  const timeout=setTimeout(()=>child.kill("SIGTERM"),45000);
  let output="";
  child.stdout.on("data",d=>{output+=d;});
  child.stderr.resume(); // Never print raw integration errors.
  child.stdin.end(JSON.stringify(input));
  try {
    const code=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",resolve);});
    assert.equal(code,0);
    return JSON.parse(output);
  } finally {clearTimeout(timeout);}
}
if(process.argv.includes("--recover-child")){
  let raw="";for await(const chunk of process.stdin) raw+=chunk;
  try{
    const input=JSON.parse(raw),p=pool();
    const t=await ticketRepo(p).findByConfirmation(input.ticketEvent,input.owner);
    const a=agenda(p);
    const r=await a.findApplied(input.agendaEvent,input.owner);
    const c=await a.findAppointment(r.appointmentId,r.ticketId,input.owner);
    process.stdout.write(JSON.stringify({ticket:digest(t),receipt:digest(r),appointment:digest(c)}));
  }catch{process.exitCode=1;}finally{await Promise.all(pools.map(p=>p.end()));}
} else {
  try {await run();} catch {
    console.log("Integration control unavailable; verify the technical cleanup journal before further writes.");
    process.exitCode=1;
  }
}

async function run(){
  const admin=pool();
  let baseline,schema,manifest,file,writes=false,cleaned=false,stage="preflight";
  const results=[];
  async function save(){await writeFile(file,JSON.stringify(manifest,null,2),{mode:0o600});}
  async function test(name,fn){
    stage=name;await fn();results.push({name,result:"PASS"});console.log(name+": PASS");
  }
  try{
    // A narrowly scoped recovery tool for an interrupted authorized run.
    const cleanupIndex=process.argv.indexOf("--cleanup-authorized");
    if(cleanupIndex>=0){
      file=process.argv[cleanupIndex+1];
      assert(/^generated-artifacts\/neon-c3-[a-f0-9-]+\.json$/.test(file));
      manifest=JSON.parse(await readFile(file,"utf8"));
      const c=await admin.connect();
      try{
        manifest.deleted=await clean(c,manifest,manifest.baseline,manifest.schema);
        manifest.cleaned=true;await save();
        console.log("Selective interrupted-run cleanup: PASS");
      }finally{c.release();}
      return;
    }
    const c=await admin.connect();
    try{
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      schema=await inspect(c);baseline=await snapshot(c);
      for(const t of tables) if(!["servicios","horarios_atencion"].includes(t))
        assert.equal(baseline[t].count,0,"Stop: nonempty operational table");
      const seq=await sequences(c);
      await c.query("ROLLBACK");
      const runId=randomUUID();
      manifest={version:1,runId,owner:"SYNTHETIC-C3-"+runId,
        prefix:"SYNTHETIC-C3-"+runId+":",schema,baseline,sequencesBefore:seq,
        startedAt:new Date().toISOString(),results};
    }finally{c.release();}
    console.log("Readonly preflight: PASS; 12 tables, FKs/indexes/checks, no triggers/RLS.");
    console.log("Initial counts:",JSON.stringify(counts(baseline)));
    if(process.argv.includes("--clock-only")){
      assert.deepEqual(await postLockBoundary(admin,pool(),pool()),
        {waitObserved:true,inclusive:true,short:false});
      console.log("SELECT-only PostgreSQL boundary after actual lock wait: PASS; 120:00 accepted, 119:59 rejected.");
      return;
    }
    if(!process.argv.includes("--commit-authorized")){
      console.log("Writes: NOT EXECUTED; --commit-authorized is required.");return;
    }
    await mkdir("generated-artifacts",{recursive:true});
    file=`generated-artifacts/neon-c3-${manifest.runId}.json`;await save();
    const {owner,prefix}=manifest;
    const service=(await admin.query(`SELECT id_servicio::text AS id FROM public.servicios
      WHERE activo IS TRUE AND categoria=$1 AND subcategoria=$2`,
      ["Nómina y prestaciones","Pago semanal"])).rows;
    assert.equal(service.length,1);
    manifest.serviceId=service[0].id;await save();
    // Before the first write, recheck every baseline and schema while writers
    // are excluded. NULL WhatsApp cannot be used for a real inbound identity.
    const setup=await admin.connect();
    try{
      writes=true;
      await locked(setup,async()=>{
        assert.equal(await inspect(setup),schema);
        assert.deepEqual(await snapshot(setup),baseline);
        await setup.query(`INSERT INTO public.colaboradores
          (id_colaborador,nombre,whatsapp,activo) VALUES ($1,$2,NULL,TRUE)`,
          [owner,"PRUEBA SINTETICA 02-C3 - NO ES PERSONA"]);
      });
    }finally{setup.release();}
    manifest.fixtureCommitted=true;await save();
    const p1=pool(),p2=pool();
    const t1=ticketRepo(wrapped(p1)),a1=agenda(wrapped(p1)),a2=agenda(wrapped(p2));
    const ticketInput=label=>({collaboratorId:owner,serviceId:manifest.serviceId,
      description:"PRUEBA SINTETICA 02-C3",summary:"PRUEBA SINTETICA 02-C3",confirmationId:prefix+label});
    const newTicket=label=>t1.createConfirmed(ticketInput(label));
    const dbNow=Number((await admin.query("SELECT extract(epoch FROM clock_timestamp())*1000 AS now")).rows[0].now);
    let date=plusDays(localDate(dbNow),7);
    while([0,6].includes(new Date(date+"T12:00:00Z").getUTCDay()))date=plusDays(date,1);
    const instant=time=>new Date(mexicoInstant(date,time)).toISOString();
    const command=(label,t,start,extra={})=>({eventId:prefix+label,collaboratorId:owner,
      ticketId:t.id,operation:"RESERVAR",start:instant(start),modality:"PRESENCIAL",confirmed:true,...extra});
    let ticket,booking,bookCommand;

    await test("01 SQL real con SAVEPOINT y ROLLBACK antes de COMMIT",async()=>{
      const outer=await admin.connect();let open=false;
      try{
        await outer.query("BEGIN");open=true;
        const scoped={async connect(){return {
          async query(sql,params){
            if(sql==="BEGIN")return outer.query("SAVEPOINT adapter_c3");
            if(sql==="COMMIT")return outer.query("RELEASE SAVEPOINT adapter_c3");
            if(sql==="ROLLBACK"){
              await outer.query("ROLLBACK TO SAVEPOINT adapter_c3");
              return outer.query("RELEASE SAVEPOINT adapter_c3");
            }
            return outer.query(sql,params);
          },release(){}
        };}};
        const t=await ticketRepo(scoped).createConfirmed(ticketInput("rollback-ticket"));
        const r=await agenda(scoped).execute(command("rollback-book",t,"14:00"));
        assert.equal(r.status,"PROGRAMADA");
        await outer.query("ROLLBACK");open=false;
        assert.equal(await t1.findByConfirmation(prefix+"rollback-ticket",owner),null);
        assert.equal(await a1.findApplied(prefix+"rollback-book",owner),null);
      }finally{if(open)await outer.query("ROLLBACK");outer.release();}
    });
    await test("02 Ticket COMMIT folio y repeticion concurrente",async()=>{
      const input=ticketInput("ticket-main");
      const pair=await Promise.all([t1.createConfirmed(input),ticketRepo(wrapped(p2)).createConfirmed(input)]);
      assert.deepEqual(pair[0],pair[1]);ticket=pair[0];
      assert.equal(ticket.folio,`NOM-${ticket.id}`);assert.equal(ticket.resolvedAt,null);
      assert.deepEqual(await ticketRepo(pool()).findByConfirmation(input.confirmationId,owner),ticket);
    });
    await test("03 Cita COMMIT y recibo original desde conexion y proceso nuevos",async()=>{
      bookCommand=command("book-main",ticket,"14:00");
      booking=await a1.execute(bookCommand);
      assert.equal(booking.status,"PROGRAMADA");
      assert.deepEqual(await a2.findApplied(bookCommand.eventId,owner),booking);
      const current=await a2.findAppointment(booking.appointmentId,ticket.id,owner);
      const child=await childRecover({owner,ticketEvent:ticket.confirmationId,agendaEvent:bookCommand.eventId});
      assert.deepEqual(child,{ticket:digest(ticket),receipt:digest(booking),appointment:digest(current)});
    });
    await test("04 Repeticion y conflicto de huella/collision ticket-cita",async()=>{
      const pair=await Promise.all([a1.execute(bookCommand),a2.execute(bookCommand)]);
      assert.deepEqual(pair,[booking,booking]);
      await rejects(()=>a2.execute({...bookCommand,start:instant("14:20")}),"EVENT_CONFLICT");
      await rejects(()=>t1.createConfirmed({...ticketInput("other"),confirmationId:bookCommand.eventId}),"EVENT_CONFLICT");
      await rejects(()=>a1.execute({...bookCommand,eventId:ticket.confirmationId}),"EVENT_CONFLICT");
    });
    await test("05 Reprogramacion misma cita y rollback real al fallar recibo",async()=>{
      const fault=wrapped(p2,{async before(sql,c){
        if(sql.includes("c2:save-receipt"))await c.query("SELECT 1/0");
      }});
      const move=command("move-rolled-back",ticket,"14:20",{
        operation:"REPROGRAMAR",appointmentId:booking.appointmentId});
      await rejects(()=>agenda(fault).execute(move),"DATABASE_UNAVAILABLE");
      assert.equal((await a2.findAppointment(booking.appointmentId,ticket.id,owner)).start,booking.start);
      assert.equal(await a2.findApplied(move.eventId,owner),null);
      const moved=await a1.execute({...move,eventId:prefix+"move-applied"});
      assert.equal(moved.appointmentId,booking.appointmentId);
      assert.equal(moved.ticketId,ticket.id);
      assert.deepEqual(await a2.execute(bookCommand),booking);
      assert.equal((await a2.findAppointment(booking.appointmentId,ticket.id,owner)).start,instant("14:20"));
    });
    await test("06 Cancelacion no resuelve/cierra; negativa expresa permite cierre",async()=>{
      const cancellation={...bookCommand,eventId:prefix+"cancel-main",operation:"CANCELAR",
        appointmentId:booking.appointmentId,start:undefined};
      const r=await a1.execute(cancellation);
      assert.equal(r.status,"CANCELADA");
      assert.deepEqual(await a2.execute(cancellation),r);
      let t=await t1.findByConfirmation(ticket.confirmationId,owner);
      assert.equal(t.status,"pendiente de cita");assert.equal(t.closedAt,null);assert.equal(t.resolvedAt,null);
      // Explicit test action representing refusal; NOT called by cancellation.
      t=await t1.closeWithoutAppointment(ticket.id,owner);
      assert.equal(t.status,"cerrado sin cita");assert(t.closedAt);assert.equal(t.resolvedAt,null);
      assert.deepEqual(await ticketRepo(pool()).findByConfirmation(ticket.confirmationId,owner),t);
      assert.deepEqual(await a2.findApplied(bookCommand.eventId,owner),booking);
      assert.deepEqual(await a2.execute(bookCommand),booking);
    });
    await test("07 Dos conexiones reales disputan mismo intervalo y modalidades",async()=>{
      const left=await newTicket("race-left"),right=await newTicket("race-right");
      const held=deferred(),release=deferred(),waiting=deferred();
      let leftPid,rightPid;
      const leftPool=wrapped(p1,{async after(sql,c){
        if(sql==="BEGIN")leftPid=(await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        if(sql.includes("c2:save-receipt")){held.resolve();await release.promise;}
      }});
      const rightPool=wrapped(p2,{async after(sql,c){
        if(sql==="BEGIN")rightPid=(await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      },async before(sql){if(sql.includes("pg_advisory_xact_lock"))waiting.resolve();}});
      const first=agenda(leftPool).execute(command("race-left-book",left,"15:00"));
      first.catch(()=>held.resolve());
      await held.promise;
      const second=agenda(rightPool).execute(command("race-right-book",right,"15:00",{modality:"REMOTA"}));
      // Attach rejection handler before releasing either connection.
      const secondResult=second.then(()=>({unexpected:true}),e=>({code:e.code}));
      try{await waiting.promise;assert.notEqual(leftPid,rightPid);await observeWait(admin,rightPid);}
      finally{release.resolve();}
      await first;assert.deepEqual(await secondResult,{code:"SLOT_UNAVAILABLE"});
      manifest.concurrentBackendsDistinct=true;
      await a2.execute(command("adjacent-book",right,"15:20",{modality:"REMOTA"}));
      const offGrid=await newTicket("off-grid");
      await rejects(()=>a1.execute(command("off-grid-overlap",offGrid,"15:10")),"SLOT_UNAVAILABLE");
    });
    await test("08 GiST real con solapamiento parcial concurrente",async()=>{
      const left=await newTicket("gist-left"),right=await newTicket("gist-right");
      const held=deferred(),release=deferred();
      const first=agenda(wrapped(p1,{async after(sql){
        if(sql.includes("c2:save-receipt")){held.resolve();await release.promise;}
      }})).execute(command("gist-book",left,"16:00"));
      first.catch(()=>held.resolve());
      await held.promise;
      const raw=await p2.connect();
      try{
        await raw.query("BEGIN");
        await raw.query("SET LOCAL lock_timeout='5s'");
        const pid=(await raw.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        // Defense-only probe: deliberately bypass application grid/global lock.
        // The rejected INSERT must never COMMIT or produce a receipt.
        const contender=raw.query(`INSERT INTO public.citas
          (id_ticket,inicio_programado,fin_programado,modalidad,estado)
          VALUES ($1,$2::timestamptz,$2::timestamptz+interval '20 minutes','REMOTA','PROGRAMADA')`,
          [right.id,instant("16:10")]).then(()=>({unexpected:true}),e=>({code:e.code}));
        try{await observeWait(admin,pid);}finally{release.resolve();}
        await first;
        assert.deepEqual(await contender,{code:"23P01"});
      }finally{release.resolve();await raw.query("ROLLBACK");raw.release();}
    });
    await test("09 Ventana, zona y bloqueo parcial temporal con ROLLBACK",async()=>{
      const t=await newTicket("calendar");
      const slots=await a1.listAvailable({ticketId:t.id,collaboratorId:owner,date,modality:"PRESENCIAL"});
      assert(slots.includes(instant("17:00")));assert(!slots.includes(instant("17:20")));
      let weekend=date;while(new Date(weekend+"T12:00:00Z").getUTCDay()!==6)weekend=plusDays(weekend,1);
      assert.deepEqual(await a1.listAvailable({ticketId:t.id,collaboratorId:owner,date:weekend,modality:"PRESENCIAL"}),[]);
      const blockDate=plusDays(date,7),c=await admin.connect();
      try{
        await c.query("BEGIN");
        await c.query("SELECT pg_advisory_xact_lock($1::bigint)",[AGENDA_LOCK_KEY]);
        await c.query(`INSERT INTO public.bloqueos_agenda
          (fecha,hora_inicio,hora_fin,motivo) VALUES ($1,'14:05','14:15',$2)`,[blockDate,prefix+"block"]);
        const scoped={async connect(){return {async query(sql,params){
          if(sql==="BEGIN")return c.query("SAVEPOINT calendar_c3");
          if(sql==="COMMIT")return c.query("RELEASE SAVEPOINT calendar_c3");
          if(sql==="ROLLBACK")return c.query("ROLLBACK TO SAVEPOINT calendar_c3");
          return c.query(sql,params);
        },release(){}};}};
        const free=await agenda(scoped).listAvailable({ticketId:t.id,collaboratorId:owner,date:blockDate,modality:"PRESENCIAL"});
        assert(!free.includes(new Date(mexicoInstant(blockDate,"14:00")).toISOString()));
        assert(free.includes(new Date(mexicoInstant(blockDate,"14:20")).toISOString()));
      }finally{await c.query("ROLLBACK");c.release();}
    });
    await test("10 Reloj PostgreSQL despues de bloqueo y frontera SQL exacta",async()=>{
      const t=await newTicket("clock");
      const holder=await p1.connect();let observerPid;
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock($1::bigint)",[AGENDA_LOCK_KEY]);
      const queued=deferred();let afterLockClock;
      const start=Number((await admin.query(
        "SELECT extract(epoch FROM clock_timestamp())*1000 AS now")).rows[0].now);
      const work=agenda(wrapped(p2,{async before(sql){if(sql.includes("pg_advisory_xact_lock"))queued.resolve();},
        async after(sql,c,params,result){
          if(sql==="BEGIN")observerPid=(await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          if(sql.includes("c2:clock"))afterLockClock=Number(result.rows[0].now);
        }})).listAvailable({ticketId:t.id,collaboratorId:owner,date,modality:"PRESENCIAL"});
      try{await queued.promise;await observeWait(admin,observerPid);await pause(250);}
      finally{await holder.query("ROLLBACK");holder.release();}
      await work;assert(afterLockClock>=start+200);
      assert.deepEqual(await postLockBoundary(admin,p1,p2),
        {waitObserved:true,inclusive:true,short:false});
      manifest.exactBoundary="PostgreSQL predicate + deterministic mock; not wall-clock end-to-end equality";
    });
    await test("11 COMMIT real con acuse perdido y recuperacion en proceso nuevo",async()=>{
      const t=await newTicket("lost-ack"),input=command("lost-book",t,"17:00");
      let injected=false;
      const fault=wrapped(p1,{async after(sql){
        if(sql==="COMMIT"&&!injected){injected=true;throw Object.assign(new Error("Synthetic lost acknowledgement"),{code:"08006"});}
      }});
      await rejects(()=>agenda(fault).execute(input),"COMMIT_OUTCOME_UNKNOWN");
      const receipt=await agenda(pool()).findApplied(input.eventId,owner);
      assert(receipt);const current=await a2.findAppointment(receipt.appointmentId,t.id,owner);
      const child=await childRecover({owner,ticketEvent:t.confirmationId,agendaEvent:input.eventId});
      assert.deepEqual(child,{ticket:digest(t),receipt:digest(receipt),appointment:digest(current)});
      assert.deepEqual(await a2.execute(input),receipt);
    });
    await test("12 Propiedad, ausencia de resolucion y limites de los fixtures",async()=>{
      await rejects(()=>a2.findApplied(bookCommand.eventId,"SYNTHETIC-NONEXISTENT-OWNER"),"ACCESS_DENIED");
      assert.equal((await admin.query(`SELECT count(*)::int AS n FROM public.tickets
        WHERE id_colaborador=$1 AND resuelto_en IS NOT NULL`,[owner])).rows[0].n,0);
      const s=await snapshot(admin);
      assert.deepEqual(s.servicios,baseline.servicios);assert.deepEqual(s.horarios_atencion,baseline.horarios_atencion);
      for(const t of ["consultas","denuncias","encuestas","fuentes","seguimientos_denuncia","bloqueos_agenda"])
        assert.deepEqual(s[t],baseline[t]);
      manifest.beforeCleanup=s;manifest.adapterSqlCounts={...sqlCounts};await save();
    });
  }catch(e){
    results.push({name:stage,result:"FAIL",code:e.code??e.name});
    console.log(`${stage}: FAIL (${e.code??e.name}); no raw error/parameters emitted.`);
    process.exitCode=1;
  }finally{
    if(writes){
      // End test connections first: no pending mutation may race with cleanup.
      await Promise.all(pools.filter(p=>p!==admin).map(p=>p.end()));
      const c=await admin.connect();
      try{
        manifest.deleted=await clean(c,manifest,baseline,schema);
        const final=await snapshot(c);assert.deepEqual(final,baseline);
        assert.equal(await inspect(c),schema);
        manifest.final=final;manifest.sequencesAfter=await sequences(c);
        manifest.cleaned=true;manifest.finishedAt=new Date().toISOString();
        cleaned=true;await save();
        console.log("Exact cleanup and all 12 table fingerprints/schema: PASS");
        console.log("Deleted synthetic rows:",JSON.stringify(manifest.deleted));
        console.log("Final counts:",JSON.stringify(counts(final)));
        console.log("Sequences (not reset):",JSON.stringify({before:manifest.sequencesBefore,after:manifest.sequencesAfter}));
      }catch(e){
        console.log("CLEANUP BLOCKED:",e.code??e.name,"; preserve technical journal; no broad delete.");
        process.exitCode=1;
      }finally{c.release();}
    }
    await admin.end();
    if(!writes)await Promise.all(pools.filter(p=>p!==admin).map(p=>p.end()));
    if(writes)console.log(`Integration groups: ${results.filter(r=>r.result==="PASS").length}/12 PASS; cleanup ${cleaned?"PASS":"FAIL"}.`);
  }
}
