import assert from "node:assert/strict";
import {messageCache,stateSweeper,MESSAGE_CACHE_TTL_MS,MEMORY_BATCH,MEMORY_INTERVAL_MS}
  from "../src/lib/server/conversation-memory.ts";
import {createPayrollReception,INACTIVITY_MS} from "../src/lib/server/payroll-reception.ts";
import {createMemoryTicketRepository} from "../src/lib/server/payroll-tickets.ts";
import {createPersistentReception} from "../src/lib/server/persistent-reception.ts";
import {fakeDatabase} from "./fixtures/persistent-agenda.mjs";
import {dependencies,phone} from "./fixtures/payroll.mjs";

let groups=0;
async function test(name,run){await run();groups++;console.log(name+": PASS");}
function clock(start=0){
  let time=start;const tasks=new Set();
  return {now:()=>time,set:v=>{time=v;},tick(){for(const task of tasks)task();},
    schedule(fn,ms){assert.equal(ms,MEMORY_INTERVAL_MS);tasks.add(fn);return()=>tasks.delete(fn);},
    timers:()=>tasks.size};
}
function payroll(){
  const c=clock(Date.parse("2026-11-09T12:00:00Z")),repo=createMemoryTicketRepository();
  const engine=createPayrollReception(dependencies(),repo,c);
  let id=0;const send=(text,key=`synthetic-${++id}`)=>engine.handleMessage(phone,text,key);
  return {c,repo,engine,send};
}
function persistentDependencies(){
  const d=dependencies();
  return {...d,lookupIdentity:async p=>{
    const i=await d.lookupIdentity(p);
    return {...i,id:i.status==="active"?"SYNTHETIC-A":null};
  }};
}

await test("Timer sin entrada borra menu/nomina a 120 min, no antes",async()=>{
  const x=payroll();const t=x.c.now();
  await x.send("Me falta el pago semanal.");assert.equal(x.engine.memoryStats().menus,1);
  x.c.set(t+INACTIVITY_MS-1);x.c.tick();assert.equal(x.engine.memoryStats().sessions,1);
  x.c.set(t+INACTIVITY_MS);x.c.tick();
  assert.equal(x.engine.memoryStats().sessions,0);assert.equal(x.engine.memoryStats().menus,0);
  assert.equal(x.repo.snapshot().length,0);x.engine.dispose();assert.equal(x.c.timers(),0);
});
await test("Cache: 50000 IDs, limite de entradas y bytes; TTL fijo sin renovacion",()=>{
  const c=clock(),cache=messageCache({...c,cacheMaxEntries:300,cacheMaxBytes:40000});
  for(let i=0;i<50000;i++)cache.set(`event-${i}`,"a".repeat(64));
  assert(cache.stats().entries<=300);assert(cache.stats().estimatedBytes<=40000);
  assert.equal(cache.get("event-0"),undefined);
  cache.set("fixed","hash");c.set(MESSAGE_CACHE_TTL_MS-1);cache.set("fixed","hash");
  assert.equal(cache.get("fixed"),"hash");c.set(MESSAGE_CACHE_TTL_MS);
  assert.equal(cache.get("fixed"),undefined);
  for(let n=0;n<4;n++)cache.sweep();assert.equal(cache.stats().entries,0);
  assert.equal(cache.stats().estimatedBytes,0);
  cache.set("x".repeat(50000),"hash");assert.equal(cache.stats().entries,0);
});
await test("Barrido incremental acotado y conservacion de filas ocupadas",()=>{
  const states=new Map(Array.from({length:1000},(_,i)=>[String(i),0]));
  const sweep=stateSweeper(states,()=>true,key=>key==="0");
  sweep();assert.equal(states.size,1000-MEMORY_BATCH+1);
  for(let n=0;n<8;n++)sweep();assert.deepEqual([...states.keys()],["0"]);
  let expired=false;
  const growing=new Map(Array.from({length:600},(_,i)=>[String(i),0]));
  const fair=stateSweeper(growing,()=>expired,()=>false);
  fair();expired=true;
  for(let pass=0;pass<8;pass++){
    for(let i=0;i<300;i++)growing.set(`new-${pass}-${i}`,0);
    fair();
  }
  assert(!growing.has("0"),"Continuous insertions must not starve old expired entries");
});
await test("Duplicado no renueva TTL; acceso expira aunque no haya timer ejecutado",async()=>{
  const x=payroll(),t=x.c.now();await x.send("Me falta el pago semanal.","original");
  x.c.set(t+INACTIVITY_MS-1);assert.equal((await x.send("Me falta el pago semanal.","original")).action,"duplicate_ignored");
  x.c.set(t+INACTIVITY_MS);await x.send("confirmo","new-confirmation");
  assert.equal(x.repo.snapshot().length,0);x.engine.dispose();
});
await test("Timer no elimina sesion/agenda en cola, incluso durante lookup externo",async()=>{
  const db=fakeDatabase();db.edit(d=>{d.tickets=[];});
  const c=clock(db.now),base=persistentDependencies();let blocked=false,release,entered;
  const started=new Promise(r=>{entered=r;});
  const gate=new Promise(r=>{release=r;});
  const engine=createPersistentReception({...base,lookupIdentity:async p=>{
    if(blocked){entered();await gate;}return base.lookupIdentity(p);
  }},db.pool,c);
  await engine.handleMessage(phone,"Me falta el pago semanal.","first");
  const before=engine.memoryStats();blocked=true;
  const pending=engine.handleMessage(phone,"06/11/2026","queued");await started;
  c.set(c.now()+INACTIVITY_MS);c.tick();
  assert.equal(engine.memoryStats().contexts,before.contexts);
  assert.equal(engine.memoryStats().payroll.sessions,before.payroll.sessions);
  blocked=false;release();await pending;c.tick();
  assert.equal(engine.memoryStats().contexts,0);
  assert.equal(engine.memoryStats().payroll.sessions,0);engine.dispose();assert.equal(c.timers(),0);
});
await test("Reinicio en menu/tema/fecha/resumen/oferta/seleccion no interpreta confirmo aislado",async()=>{
  const booked=["1","Pago semanal","06/11/2026","Explicacion sintetica suficiente.","confirmo","si","1","confirmo"];
  const phases=[[],["1"],["1","Pago semanal"],["1","Pago semanal","06/11/2026"],
    ["1","Pago semanal","06/11/2026","Explicacion sintetica suficiente."],
    ["1","Pago semanal","06/11/2026","Explicacion sintetica suficiente.","confirmo"],
    ["1","Pago semanal","06/11/2026","Explicacion sintetica suficiente.","confirmo","si","1"],
    [...booked,"cancelar cita"],[...booked,"reprogramar cita"],
    [...booked,"reprogramar cita","confirmo"],
    [...booked,"reprogramar cita","confirmo","1"]];
  for(const texts of phases){
    const db=fakeDatabase();db.edit(d=>{d.tickets=[];});const c=clock(db.now);
    let engine=createPersistentReception(persistentDependencies(),db.pool,c),n=0;
    for(const text of texts)await engine.handleMessage(phone,text,`phase-${++n}`);
    const prior=db.snapshot();engine.dispose();engine=createPersistentReception(persistentDependencies(),db.pool,c);
    assert.equal((await engine.handleMessage(phone,"confirmo","after-restart")).action,"agenda_context_required");
    assert.deepEqual(db.snapshot(),prior);engine.dispose();assert.equal(c.timers(),0);
  }
});
await test("Timer limpia agenda y payroll sin mensajes; confirmo caducado no muta SQL simulado",async()=>{
  const db=fakeDatabase();db.edit(d=>{d.tickets=[];});const c=clock(db.now);
  const engine=createPersistentReception(persistentDependencies(),db.pool,c);
  await engine.handleMessage(phone,"Me falta el pago semanal.","need");
  await engine.handleMessage(phone,"06/11/2026","date");
  c.set(c.now()+INACTIVITY_MS);c.tick();
  assert.equal(engine.memoryStats().contexts,0);
  assert.equal(engine.memoryStats().payroll.sessions,0);
  assert.equal(engine.memoryStats().payroll.menus,0);
  await engine.handleMessage(phone,"confirmo","expired");
  assert.equal(db.snapshot().tickets.length,0);engine.dispose();
});
await test("Recuperacion durable de ticket tras TTL de cache y reinicio no renueva actividad",async()=>{
  const db=fakeDatabase();db.edit(d=>{d.tickets=[];});const c=clock(db.now);
  let engine=createPersistentReception(persistentDependencies(),db.pool,c);
  for(const [i,text] of ["1","Pago semanal","06/11/2026","Explicacion sintetica suficiente.","confirmo"].entries())
    await engine.handleMessage(phone,text,`durable-${i}`);
  assert.equal(db.snapshot().tickets.length,1);const original=db.snapshot();
  c.set(c.now()+MESSAGE_CACHE_TTL_MS);for(let i=0;i<3;i++)c.tick();
  engine.dispose();engine=createPersistentReception(persistentDependencies(),db.pool,c);
  assert.equal((await engine.handleMessage(phone,"confirmo","durable-4")).action,"payroll_ticket_replayed");
  assert.equal(engine.memoryStats().contexts,0);
  assert.deepEqual(db.snapshot(),original);engine.dispose();
});
await test("Recibo de cita sobrevive limpieza de cache y reinicio sin repetir SQL de negocio",async()=>{
  const db=fakeDatabase();db.edit(d=>{d.tickets=[];});const c=clock(db.now);
  let engine=createPersistentReception(persistentDependencies(),db.pool,c);
  const texts=["1","Pago semanal","06/11/2026","Explicacion sintetica suficiente.","confirmo","si","1","confirmo"];
  for(const [i,text] of texts.entries())await engine.handleMessage(phone,text,`appointment-${i}`);
  const prior=db.snapshot();assert.equal(prior.appointments.length,1);
  c.set(c.now()+MESSAGE_CACHE_TTL_MS);for(let i=0;i<3;i++)c.tick();
  engine.dispose();engine=createPersistentReception(persistentDependencies(),db.pool,c);
  assert.equal((await engine.handleMessage(phone,"confirmo","appointment-7")).action,"agenda_replayed");
  assert.equal(engine.memoryStats().contexts,0);assert.deepEqual(db.snapshot(),prior);
  engine.dispose();
});
console.log(`02-D1A: ${groups} grupos PASS; reloj/timers/SQL ficticios, cero Neon.`);
