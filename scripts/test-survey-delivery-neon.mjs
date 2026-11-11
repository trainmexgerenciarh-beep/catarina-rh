import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {spawn} from "node:child_process";
import pg from "pg";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
import {createNeonSurveyDelivery,parseDelivery} from "../src/lib/server/neon-survey-delivery.ts";
import {createSurveyDispatcher} from "../src/lib/server/survey-dispatcher.ts";
import {createCronHandler} from "../src/lib/server/cron-handler.ts";
import {dispatchSyntheticSurveys} from "../src/lib/server/survey-test-runner.ts";
import {readRH} from "../src/lib/server/rh-service.ts";

const p=new pg.Pool(neonPoolOptions());
if(process.argv.includes("--child")){
  let input="";for await(const s of process.stdin)input+=s;
  try{
    const x=JSON.parse(input),r=createNeonSurveyDelivery(p);
    const result=x.action==="claim"?await r.claim(0):
      x.action==="dispatch"?await dispatchSyntheticSurveys(p):
      await r.settle(x.id,x.token,x.result);
    process.stdout.write(JSON.stringify({result:result??null}));
  }catch(e){process.stdout.write(JSON.stringify({error:e.message}));process.exitCode=1;}
  finally{await p.end();}
}else{
  let before,tables,seqBefore,created=false,groups=0;
  const owner="SYNTHETIC-DELIVERY-"+randomUUID(),ticketIds=[],appointmentIds=[],surveyIds=[];
  const pass=s=>{groups++;console.log(s+": PASS");};
  const snap=async()=>{
    const result={};
    for(const t of tables){assert(/^[a-z_]+$/.test(t));
      result[t]=(await p.query(`SELECT count(*)::int n,md5(coalesce(string_agg(to_jsonb(r)::text,'|' ORDER BY to_jsonb(r)::text),'')) hash FROM public.${t} r`)).rows[0];}
    return result;
  };
  const child=x=>new Promise((resolve,reject)=>{
    const c=spawn(process.execPath,["scripts/test-survey-delivery-neon.mjs","--child"],{stdio:["pipe","pipe","ignore"]});
    let out="";const timer=setTimeout(()=>{c.kill();reject(new Error("CHILD_TIMEOUT"));},30000);
    c.stdout.on("data",s=>out+=s);c.on("error",reject);c.on("close",code=>{
      clearTimeout(timer);try{const data=JSON.parse(out);code===0?resolve(data.result):reject(new Error(data.error));}catch(e){reject(e);}
    });c.stdin.end(JSON.stringify(x));
  });
  const receipt=async id=>(await p.query("SELECT entrega,enviada_en,recibio_atencion FROM public.encuestas WHERE id_encuesta=$1",[id])).rows[0];
  const alterOwn=async(id,data)=>{
    assert(surveyIds.includes(id));
    await p.query("UPDATE public.encuestas SET entrega=$2 WHERE id_encuesta=$1",[id,JSON.stringify(data)]);
  };
  try{
    tables=(await p.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
    assert.equal(tables.length,16);
    assert.equal((await p.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='encuestas' AND column_name='entrega'")).rows[0]?.data_type,"jsonb");
    before=await snap();
    assert.equal(before.servicios.n,15);assert.equal(before.horarios_atencion.n,5);
    // Deliberately conservative: do not run while operational records exist.
    for(const t of tables.filter(t=>!["servicios","horarios_atencion"].includes(t)))assert.equal(before[t].n,0,"ISOLATION_REQUIRED");
    seqBefore=(await p.query("SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
    console.log(JSON.stringify({phase:"baseline",counts:Object.fromEntries(tables.map(t=>[t,before[t].n])),fingerprint:createHash("sha256").update(JSON.stringify(before)).digest("hex")}));
    assert(process.argv.includes("--authorized-synthetic-commit"),"EXPLICIT_FIXTURE_COMMIT_FLAG_REQUIRED");
    const service=(await p.query("SELECT id_servicio::text FROM public.servicios WHERE activo AND categoria='Nómina y prestaciones' ORDER BY id_servicio LIMIT 1")).rows[0].id_servicio;
    // Cleanup identity is established BEFORE writing; one owner, returned IDs.
    created=true;
    await p.query("INSERT INTO public.colaboradores(id_colaborador,nombre,whatsapp,activo) VALUES($1,'SYNTHETIC DELIVERY TEST','000000000000002',true)",[owner]);
    const fixture=async()=>{
      const c=await p.connect();
      try{
      await c.query("BEGIN");
      const ticket=(await c.query(`INSERT INTO public.tickets(id_colaborador,id_servicio,resumen,estado,id_mensaje_confirmacion)
        VALUES($1,$2,'SYNTHETIC DELIVERY TEST','abierto',$3) RETURNING id_ticket::text`,[owner,service,"synthetic-delivery-"+randomUUID()])).rows[0].id_ticket;
      ticketIds.push(ticket);
      const cita=(await c.query(`INSERT INTO public.citas(id_ticket,inicio_programado,fin_programado,modalidad,estado)
        VALUES($1,'2020-01-06 20:00:00+00','2020-01-06 20:20:00+00','PRESENCIAL','REALIZADA') RETURNING id_cita::text`,[ticket])).rows[0].id_cita;
      appointmentIds.push(cita);
      const id=(await c.query("INSERT INTO public.encuestas(id_cita) VALUES($1) RETURNING id_encuesta::text",[cita])).rows[0].id_encuesta;
      surveyIds.push(id);await c.query("COMMIT");return id;
      }catch(e){await c.query("ROLLBACK");throw e;}
      finally{c.release();}
    };
    const repo=createNeonSurveyDelivery(p);
    let id=await fixture();
    const claims=await Promise.all([child({action:"claim"}),child({action:"claim"})]);
    const job=claims.find(Boolean);assert.equal(claims.filter(Boolean).length,1);assert.equal(job.id,id);
    assert.equal((await receipt(id)).entrega.attempts,1);
    pass("COMMIT de reclamación y dos procesos independientes: un ganador, un intento");
    await assert.rejects(repo.settle(id,randomUUID(),{state:"ACEPTADA",code:"PROVIDER_ACCEPTED",providerId:"synthetic"}),/FENCE/);
    await child({action:"settle",id,token:job.token,result:{state:"ACEPTADA",code:"PROVIDER_ACCEPTED",providerId:"synthetic-ack"}});
    assert.equal(await child({action:"claim"}),null);
    assert.equal((await receipt(id)).entrega.state,"ACEPTADA");
    assert.equal((await receipt(id)).enviada_en,null);
    assert.equal((await receipt(id)).recibio_atencion,null);
    pass("Acuse durable leído tras reinicio; fencing rechaza token ajeno; ficticio no marca envío ni atención");
    id=await fixture();const lost=await child({action:"claim"});
    await alterOwn(id,{...(await receipt(id)).entrega,leaseUntil:1});
    assert.equal(await child({action:"claim"}),null);
    assert.equal((await receipt(id)).entrega.state,"REVISION");
    await child({action:"settle",id,token:lost.token,result:{state:"ACEPTADA",code:"PROVIDER_ACCEPTED",providerId:"synthetic-late-ack"}});
    assert.equal((await receipt(id)).entrega.state,"ACEPTADA");
    pass("Caída/acuse perdido: lease vencido no reenvía; acuse tardío con mismo fencing puede asentarse");
    id=await fixture();let calls=0;
    const retry=createSurveyDispatcher(repo,{mode:"FAKE_ONLY",async send(){calls++;return {status:"RETRYABLE",code:"RATE_LIMITED"};}},{template:"synthetic_test",language:"es_MX"});
    await retry.run();assert.equal(calls,1);assert.equal((await receipt(id)).entrega.state,"REINTENTAR");
    const firstToken=(await receipt(id)).entrega.token;
    await retry.run();assert.equal(calls,1);
    for(let n=2;n<=3;n++){
      await alterOwn(id,{...(await receipt(id)).entrega,nextAt:1});
      await retry.run();assert.equal((await receipt(id)).entrega.attempts,n);
    }
    assert.equal((await receipt(id)).entrega.state,"REVISION");
    await assert.rejects(repo.settle(id,firstToken,{state:"ACEPTADA",code:"PROVIDER_ACCEPTED",providerId:"synthetic-stale"}),/FENCE/);
    pass("Reintento solo de rechazo conocido, backoff en reloj DB y máximo tres intentos");
    id=await fixture();let unknownCalls=0;
    await createSurveyDispatcher(repo,{mode:"FAKE_ONLY",async send(){unknownCalls++;throw new Error("synthetic-timeout");}},{template:"synthetic_test",language:"es_MX"}).run();
    assert.equal((await receipt(id)).entrega.state,"REVISION");
    assert.equal(await repo.claim(Date.now()),null);assert.equal(unknownCalls,1);
    pass("Resultado externo incierto persistido: sin reenvío ciego entre procesos");
    id=await fixture();const failed=await repo.claim(0);
    const snapshot=(await receipt(id)).entrega;
    await assert.rejects(repo.settle(id,failed.token,{state:"ACEPTADA",code:"bad narrative",providerId:"fake"}),/INVALID/);
    assert.deepEqual((await receipt(id)).entrega,snapshot);
    await repo.settle(id,failed.token,{state:"DESCARTADA",code:"TEST_FINISHED"});
    pass("Fallo antes de COMMIT revierte actualización; contrato sin narraciones ni secretos");
    id=await fixture();
    const key="synthetic-cron-secret-not-an-actual-secret";
    const handler=createCronHandler({secret:()=>key,prepare:async()=>({prepared:0,outbound:false}),dispatchTest:()=>dispatchSyntheticSurveys(p)});
    const req=(task,k=key)=>({request:new Request("https://synthetic.invalid/api/cron",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+k},body:JSON.stringify({task})})});
    assert.equal((await handler(req("dispatch_test","wrong"))).status,401);
    assert.equal((await handler(req("dispatch"))).status,409);
    const runs=await Promise.all([handler(req("dispatch_test")),handler(req("dispatch_test"))]);
    assert(runs.every(r=>r.status===200));
    assert.equal((await receipt(id)).entrega.attempts,1);
    assert.equal((await receipt(id)).entrega.mode,"FAKE_ONLY");
    pass("Cron dual autenticado con SQL real y transporte falso: un envío ficticio, real OFF");
    id=await fixture();const unknown=await repo.claim(0);
    await alterOwn(id,{...(await receipt(id)).entrega,leaseUntil:1});
    await child({action:"dispatch"});await child({action:"dispatch"});
    assert.equal((await receipt(id)).entrega.attempts,1);
    assert.equal((await receipt(id)).entrega.state,"REVISION");
    assert(unknown);
    pass("Dos reinicios posteriores no reenvían una reclamación expirada sin acuse");
    id=await fixture();
    await createSurveyDispatcher(repo,{mode:"FAKE_ONLY",async send(){
      const c=await p.connect();
      try{await c.query("BEGIN");await c.query("SELECT id_encuesta FROM public.encuestas WHERE id_encuesta=$1 FOR UPDATE NOWAIT",[id]);await c.query("ROLLBACK");}
      finally{c.release();}
      return {status:"ACCEPTED",messageId:"synthetic-unlocked"};
    }},{template:"synthetic_test",language:"es_MX"}).run();
    assert.equal((await receipt(id)).entrega.state,"ACEPTADA");
    pass("Transporte fuera de transacción/lock: segunda conexión obtiene fila NOWAIT durante envío ficticio");
    const administrative=(await readRH(p,"encuestas","generalista")).find(r=>r.id_encuesta===id);
    assert.equal(administrative.estado_entrega,"ACEPTADA");assert.equal(administrative.modo_entrega,"FAKE_ONLY");
    assert(!Object.hasOwn(administrative,"entrega"));assert(!JSON.stringify(administrative).includes("leaseUntil"));
    assert(!JSON.stringify(administrative).includes("token"));
    pass("Panel lee estado/modo técnico de entrega, sin exponer token ni lease del worker");
    const old={v:1,mode:"FAKE_ONLY",state:"PENDIENTE",attempts:0,fence:0,nextAt:0,updatedAt:0};
    assert(parseDelivery(old));assert.throws(()=>parseDelivery({...old,v:2}));
    assert.throws(()=>parseDelivery({...old,state:"EN_CURSO"}));
    assert.throws(()=>parseDelivery({...old,mode:"REAL"}));
    assert.throws(()=>parseDelivery({...old,narrative:"not permitted"}));
    assert.equal((await p.query("SELECT count(*)::int n FROM public.tickets WHERE id_ticket=ANY($1::bigint[]) AND resuelto_en IS NOT NULL",[ticketIds])).rows[0].n,0);
    pass("Versión/modo/lease inválidos rechazados y tickets nunca resueltos por entrega");
    console.log(`DELIVERY NEON: ${groups} grupos PASS; SQL/COMMIT real, transporte exclusivamente ficticio.`);
  }catch(e){console.error("DELIVERY_TEST_FAILED",e.code??e.message);process.exitCode=1;}
  finally{
    if(created){
      const c=await p.connect();
      try{
        await c.query("BEGIN");
        // Discover only rows linked to the one captured synthetic owner, never broad predicates.
        const tickets=(await c.query("SELECT id_ticket::text FROM public.tickets WHERE id_colaborador=$1",[owner])).rows.map(x=>x.id_ticket);
        assert(tickets.every(x=>ticketIds.includes(x)));
        const citas=(await c.query("SELECT id_cita::text FROM public.citas WHERE id_ticket=ANY($1::bigint[])",[tickets])).rows.map(x=>x.id_cita);
        assert(citas.every(x=>appointmentIds.includes(x)));
        const surveys=(await c.query("SELECT id_encuesta::text FROM public.encuestas WHERE id_cita=ANY($1::bigint[])",[citas])).rows.map(x=>x.id_encuesta);
        assert(surveys.every(x=>surveyIds.includes(x)));
        const removed={};
        removed.encuestas=(await c.query("DELETE FROM public.encuestas WHERE id_encuesta=ANY($1::bigint[])",[surveys])).rowCount;
        removed.citas=(await c.query("DELETE FROM public.citas WHERE id_cita=ANY($1::bigint[])",[citas])).rowCount;
        removed.tickets=(await c.query("DELETE FROM public.tickets WHERE id_ticket=ANY($1::bigint[])",[tickets])).rowCount;
        removed.colaboradores=(await c.query("DELETE FROM public.colaboradores WHERE id_colaborador=$1",[owner])).rowCount;
        await c.query("COMMIT");
        const after=await snap();assert.deepEqual(after,before);
        console.log(JSON.stringify({phase:"cleanup",removed,all16FingerprintsUnchanged:true,counts:Object.fromEntries(tables.map(t=>[t,after[t].n])),fingerprint:createHash("sha256").update(JSON.stringify(after)).digest("hex"),sequencesBefore:seqBefore,sequencesAfter:(await p.query("SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows}));
      }catch(e){await c.query("ROLLBACK").catch(()=>{});console.error("CLEANUP_FAILED_STOP",e.code??e.message);process.exitCode=1;}
      finally{c.release();}
    }
    await p.end();
  }
}
