import assert from "node:assert/strict";
import pg from "pg";
import {createHmac,randomUUID} from "node:crypto";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {createPersistentReception} from "../src/lib/server/persistent-reception.ts";
import {createWebhookPost} from "../src/lib/server/whatsapp-webhook-post.ts";
import {createNeonAgendaRepository} from "../src/lib/server/neon-agenda.ts";
import {lookupCollaboratorIdentity,listActiveServices,closeNeonPool} from "../src/lib/server/neon-collaborators.ts";
import {classifyService} from "../src/lib/server/gemini-service-classifier.ts";
import {inspect,snapshot,counts,sequences,locked,clean,digest,tables} from "./fixtures/neon-c3-safety.mjs";
import {localDate,plusDays} from "../src/lib/server/agenda-time.ts";

const phone="000000000000099"; // Non-E.164, non-routable; never used for sending.
const description="PRUEBA SINTETICA 02-C4: diferencia ficticia en el pago.";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:10000});
const dependencies={lookupIdentity:lookupCollaboratorIdentity,listActiveServices,classifyService};
const payload=messages=>({object:"whatsapp_business_account",entry:[{changes:[{field:"messages",value:{messages}}]}]});
const message=(id,text,from=phone)=>({id,from,type:"text",text:{body:text}});
function request(data,valid=true){
  const body=JSON.stringify(data);
  const hash=createHmac("sha256",process.env.WHATSAPP_APP_SECRET).update(Buffer.from(body)).digest("hex");
  return new Request("https://synthetic.invalid/api/whatsapp/webhook",{method:"POST",body,
    headers:{"content-type":"application/json","x-hub-signature-256":valid?`sha256=${hash}`:"sha256="+"0".repeat(64)}});
}
const silent={info(){},error(){}};
if(process.argv.includes("--recover-child")){
  let raw="";for await(const chunk of process.stdin)raw+=chunk;
  try{
    const input=JSON.parse(raw);
    const manager=createPersistentReception(dependencies,pool);
    const post=createWebhookPost(()=>manager,{logger:silent});
    const r=await post({request:request(payload([message(input.event,"confirmo")]))});
    assert.equal(r.status,200);
    const receipt=await createNeonAgendaRepository(pool,{mode:"SIMULATION_ONLY"})
      .findApplied(input.event,input.owner);
    process.stdout.write(JSON.stringify({status:r.status,receipt:digest(receipt)}));
  }catch{process.exitCode=1;}
  finally{await pool.end();await closeNeonPool();}
}else{
  try{await run();}catch{console.log("Integration control unavailable; retain cleanup journal.");process.exitCode=1;}
}
async function child(input){
  const p=spawn(process.execPath,["scripts/test-webhook-neon.mjs","--recover-child"],{
    env:process.env,stdio:["pipe","pipe","pipe"]});
  let out="";p.stdout.on("data",v=>{out+=v;});p.stderr.resume();
  p.stdin.end(JSON.stringify(input));const timer=setTimeout(()=>p.kill(),45000);
  try{
    const code=await new Promise((resolve,reject)=>{p.on("close",resolve);p.on("error",reject);});
    assert.equal(code,0);return JSON.parse(out);
  }finally{clearTimeout(timer);}
}
async function run(){
  let manifest,file,writes=false,baseline,schema,stage="preflight";
  const results=[];
  async function save(){await writeFile(file,JSON.stringify(manifest,null,2),{mode:0o600});}
  async function test(name,fn){stage=name;await fn();results.push({name,result:"PASS"});console.log(name+": PASS");}
  try{
    const recovery=process.argv.indexOf("--cleanup-authorized");
    if(recovery>=0){
      file=process.argv[recovery+1];assert(/^generated-artifacts\/neon-c4-[a-f0-9-]+\.json$/.test(file));
      manifest=JSON.parse(await readFile(file,"utf8"));assert.equal(manifest.iteration,"02-C4");
      const c=await pool.connect();try{manifest.deleted=await clean(c,manifest,manifest.baseline,manifest.schema);
        manifest.cleaned=true;await save();console.log("Exact recovery cleanup: PASS");}finally{c.release();}
      return;
    }
    const c=await pool.connect();
    try{
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      schema=await inspect(c);baseline=await snapshot(c);
      for(const t of tables)if(!["servicios","horarios_atencion"].includes(t))assert.equal(baseline[t].count,0);
      const before=await sequences(c);await c.query("ROLLBACK");
      const id=randomUUID();manifest={iteration:"02-C4",owner:"SYNTHETIC-C4-"+id,
        prefix:"SYNTHETIC-C4-"+id+":",fixtureDescription:description,whatsapp:phone,
        schema,baseline,sequencesBefore:before,startedAt:new Date().toISOString(),results};
    }finally{c.release();}
    console.log("Readonly preflight PASS; 12 tables, 15 services, 5 hours.");
    console.log("Initial counts:",JSON.stringify(counts(baseline)));
    if(!process.argv.includes("--commit-authorized")){console.log("Writes NOT EXECUTED; explicit authorization flag required.");return;}
    assert(process.env.WHATSAPP_APP_SECRET && process.env.REPLIT_DEV_DOMAIN);
    await mkdir("generated-artifacts",{recursive:true});
    file=`generated-artifacts/neon-c4-${manifest.owner.slice("SYNTHETIC-C4-".length)}.json`;await save();
    const setup=await pool.connect();
    try{
      writes=true;
      await locked(setup,async()=>{
        assert.equal(await inspect(setup),schema);assert.deepEqual(await snapshot(setup),baseline);
        await setup.query(`INSERT INTO public.colaboradores (id_colaborador,nombre,whatsapp,activo)
          VALUES ($1,$2,$3,TRUE)`,[manifest.owner,"PRUEBA SINTETICA 02-C4 - NO ES PERSONA",phone]);
      });
    }finally{setup.release();}
    const prefix=manifest.prefix,owner=manifest.owner;
    let seq=0;
    async function live(messages,valid=true){
      const req=request(payload(messages),valid);
      return fetch(`https://${process.env.REPLIT_DEV_DOMAIN}/api/whatsapp/webhook`,{
        method:"POST",headers:req.headers,body:await req.text()});
    }
    const send=(text,id=prefix+"live-"+(++seq))=>live([message(id,text)]);
    const assertOK=async r=>{assert.equal(r.status,200);assert.deepEqual(await r.json(),{received:true});};
    const fixtureTickets=async()=>(await pool.query(`SELECT id_ticket::text AS id,
      id_mensaje_confirmacion AS event,estado,cerrado_en,resuelto_en FROM public.tickets
      WHERE id_colaborador=$1 ORDER BY id_ticket`,[owner])).rows;
    const appointments=async()=>(await pool.query(`SELECT a.id_cita::text AS id,a.id_ticket::text AS ticket,
      a.inicio_programado::text AS start,a.estado FROM public.citas a JOIN public.tickets t
      ON t.id_ticket=a.id_ticket WHERE t.id_colaborador=$1 ORDER BY a.id_cita`,[owner])).rows;
    const now=Number((await pool.query("SELECT extract(epoch FROM clock_timestamp())*1000 AS now")).rows[0].now);
    let date=plusDays(localDate(now),7);
    while([0,6].includes(new Date(date+"T12:00:00Z").getUTCDay()))date=plusDays(date,1);
    let first,bookEvent,firstAppointment,firstStart;
    await test("01 HTTP real HMAC, lote malformado y acceso denegado sin efectos",async()=>{
      const before=await snapshot(pool);
      assert.equal((await live([message(prefix+"invalid","confirmo")],false)).status,401);
      const missing=await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}/api/whatsapp/webhook`,{
        method:"POST",body:JSON.stringify(payload([]))});
      assert.equal(missing.status,401);
      assert.equal((await live([message(prefix+"would-write","confirmo"),{type:"text"}])).status,400);
      await assertOK(await live([message(prefix+"unknown","confirmo","000000000000088")]));
      await pool.query("UPDATE public.colaboradores SET activo=FALSE WHERE id_colaborador=$1 AND whatsapp=$2",[owner,phone]);
      try{await assertOK(await send("confirmo"));}finally{
        await pool.query("UPDATE public.colaboradores SET activo=TRUE WHERE id_colaborador=$1 AND whatsapp=$2",[owner,phone]);
      }
      assert.deepEqual(await snapshot(pool),before);
    });
    await test("02 HTTP real resumen, confirmacion y lote duplicado: un ticket",async()=>{
      for(const text of ["1","Pago semanal","06/11/2026",description])await assertOK(await send(text));
      assert.equal((await fixtureTickets()).length,0);
      const event=message(prefix+"ticket-live","confirmo");
      await assertOK(await live([event,event]));await assertOK(await live([event]));
      const rows=await fixtureTickets();assert.equal(rows.length,1);first=rows[0];
      assert.equal(first.resuelto_en,null);assert.equal(first.estado,"pendiente de cita");
    });
    await test("03 HTTP real agenda, reprogramacion, replay, cancelacion y cierre expreso",async()=>{
      for(const text of ["si",`opciones ${date}`,"1"])await assertOK(await send(text));
      bookEvent=prefix+"book-live";await assertOK(await send("confirmo",bookEvent));
      let rows=await appointments();assert.equal(rows.length,1);
      firstAppointment=rows[0].id;firstStart=rows[0].start;
      for(const text of ["reprogramar cita","confirmo",`opciones ${date}`,"1","confirmo"])
        await assertOK(await send(text));
      rows=await appointments();assert.equal(rows[0].id,firstAppointment);
      assert.notEqual(rows[0].start,firstStart);const moved=rows[0].start;
      await assertOK(await send("confirmo",bookEvent));assert.equal((await appointments())[0].start,moved);
      for(const text of ["cancelar cita","confirmo"])await assertOK(await send(text));
      assert.equal((await appointments())[0].estado,"CANCELADA");
      assert.equal((await fixtureTickets())[0].estado,"pendiente de cita");
      await assertOK(await send("sin cita"));
      const t=(await fixtureTickets())[0];assert.equal(t.estado,"cerrado sin cita");
      assert(t.cerrado_en);assert.equal(t.resuelto_en,null);
    });
    let fault=null,mutated=false;
    const faultyPool={async connect(){
      const c=await pool.connect();return {
        async query(sql,params){
          if(sql==="BEGIN")mutated=false;
          if(sql.startsWith("INSERT INTO public.tickets")||sql.includes("c2:book")||sql.includes("c2:change"))
            mutated=true;
          if(fault==="rollback"&&sql.includes("c2:save-receipt")){fault=null;await c.query("SELECT 1/0");}
          const r=await c.query(sql,params);
          if(sql==="COMMIT"&&mutated&&fault==="lost"){fault=null;throw Object.assign(new Error("Synthetic ack loss"),{code:"08006"});}
          return r;
        },release:destroy=>c.release(destroy)
      };
    }};
    let manager=createPersistentReception(dependencies,faultyPool);
    const post=createWebhookPost(()=>manager,{logger:silent});
    const local=messages=>post({request:request(payload(messages))});
    let second,secondAppointment,secondBook;
    await test("04 Handler firmado + SQL real: lote parcial, ROLLBACK y reentrega",async()=>{
      const texts=["1","Pago semanal","06/11/2026",description,"confirmo","si",`opciones ${date}`,"1","confirmo","consultar cita"];
      const batch=texts.map((text,i)=>message(prefix+"batch-"+i,text));
      fault="rollback";
      assert.equal((await local(batch)).status,503);
      let rows=await fixtureTickets();assert.equal(rows.length,2);
      second=rows[1];assert.equal((await appointments()).length,1);
      await assertOK(await local(batch));rows=await appointments();assert.equal(rows.length,2);
      secondAppointment=rows[1].id;secondBook=prefix+"batch-8";
      await assertOK(await local(batch));assert.equal((await fixtureTickets()).length,2);
    });
    await test("05 Handler + COMMIT real con acuse perdido, proceso nuevo y replay antiguo",async()=>{
      for(const text of ["reprogramar cita","confirmo",`opciones ${date}`,"1"])
        await assertOK(await local([message(prefix+"move-"+(++seq),text)]));
      const event=prefix+"lost-move";fault="lost";
      assert.equal((await local([message(event,"confirmo")])).status,503);
      const rows=await appointments();assert.equal(rows[1].id,secondAppointment);assert.equal(rows[1].ticket,second.id);
      const repo=createNeonAgendaRepository(pool,{mode:"SIMULATION_ONLY"});
      const receipt=await repo.findApplied(event,owner);assert(receipt);
      assert.deepEqual(await child({event,owner}),{status:200,receipt:digest(receipt)});
      manager=createPersistentReception(dependencies,faultyPool);
      await assertOK(await local([message(event,"confirmo")]));
      const current=(await appointments())[1].start;
      await assertOK(await local([message(secondBook,"confirmo")]));
      assert.equal((await appointments())[1].start,current);
      const original=await repo.findApplied(secondBook,owner);
      await assert.rejects(()=>repo.execute({eventId:secondBook,collaboratorId:owner,
        ticketId:second.id,operation:"RESERVAR",start:receipt.start,modality:"PRESENCIAL",confirmed:true}),
        e=>e.code==="EVENT_CONFLICT");
      assert(original);
    });
    await test("06 Estados, folios, recibos y configuracion institucional intactos",async()=>{
      const rows=await fixtureTickets();assert.equal(rows.length,2);
      assert(rows.every(r=>r.resuelto_en===null));
      assert.equal(rows[0].estado,"cerrado sin cita");assert.equal(rows[1].estado,"pendiente de cita");
      const s=await snapshot(pool);manifest.beforeCleanup=s;
      assert.equal(s.citas.count,2);assert.equal(s.operaciones_citas.count,5);
      for(const t of tables)if(!["colaboradores","tickets","citas","operaciones_citas"].includes(t))
        assert.deepEqual(s[t],baseline[t]);
      await save();
    });
  }catch(e){
    results.push({name:stage,result:"FAIL",code:e.code??e.name});
    console.log(stage+": FAIL ("+(e.code??e.name)+"); raw errors omitted.");process.exitCode=1;
  }finally{
    if(writes){
      const c=await pool.connect();
      try{
        manifest.deleted=await clean(c,manifest,baseline,schema);
        manifest.final=await snapshot(c);assert.deepEqual(manifest.final,baseline);
        manifest.sequencesAfter=await sequences(c);manifest.cleaned=true;
        manifest.finishedAt=new Date().toISOString();await save();
        console.log("Exact cleanup + 12 content fingerprints + metadata: PASS");
        console.log("Deleted synthetic rows:",JSON.stringify(manifest.deleted));
        console.log("Final counts:",JSON.stringify(counts(manifest.final)));
        console.log("Sequences not reset:",JSON.stringify({before:manifest.sequencesBefore,after:manifest.sequencesAfter}));
      }catch(e){console.log("CLEANUP BLOCKED:",e.code??e.name,"; retain journal, no broad delete.");process.exitCode=1;}
      finally{c.release();}
    }
    await pool.end();await closeNeonPool();
    if(writes)console.log(`02-C4 Neon: ${results.filter(r=>r.result==="PASS").length}/6 groups PASS; cleanup ${manifest.cleaned?"PASS":"FAIL"}.`);
  }
}
