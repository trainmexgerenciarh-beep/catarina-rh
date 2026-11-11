import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {fakeDatabase} from "./fixtures/persistent-agenda.mjs";
import {createPersistentReception} from "../src/lib/server/persistent-reception.ts";
import {createWebhookPost} from "../src/lib/server/whatsapp-webhook-post.ts";

const phone="000000000000099",secret="SYNTHETIC-LOCAL-TEST-NOT-A-CREDENTIAL";
const description="PRUEBA SINTETICA 02-C4: diferencia ficticia en el pago.";
const catalog=[
  ...["Pago semanal","Despensa","Gasolina","Recibo","Premios","Horas extra","Descuentos","Otros"]
    .map((subcategoria,i)=>({idServicio:String(i+1),categoria:"Nómina y prestaciones",subcategoria})),
  ...Array.from({length:5},(_,i)=>({idServicio:String(i+9),categoria:"Políticas y procedimientos",subcategoria:"Ficticio"})),
  ...Array.from({length:2},(_,i)=>({idServicio:String(i+14),categoria:"Tu Voz en Trainmex",subcategoria:"Ficticio"}))
];
export const envelope = messages => ({object:"whatsapp_business_account",entry:[{
  changes:[{field:"messages",value:{messages}}]
}]});
export const message = (id,body,from=phone) => ({id,from,type:"text",text:{body}});
export function signedRequest(payload,key=secret,valid=true){
  const body=typeof payload==="string"?payload:JSON.stringify(payload);
  const signature=createHmac("sha256",key).update(Buffer.from(body)).digest("hex");
  return new Request("https://synthetic.invalid/api/whatsapp/webhook",{method:"POST",
    body,headers:{"x-hub-signature-256":valid?`sha256=${signature}`:"sha256="+"0".repeat(64)}});
}
let groups=0;
async function test(name,fn){await fn();groups++;console.log(name+": PASS");}
function fixture(){
  const db=fakeDatabase();db.edit(d=>{d.tickets=[];});
  let active=true,identityCalls=0;
  let loseCommit=false;
  const mutationPool={async connect(){
    const c=await db.pool.connect();return {
      async query(sql,params){
        if(loseCommit && (sql.startsWith("INSERT INTO public.tickets") ||
          sql.includes("c2:book") || sql.includes("c2:change"))){
          loseCommit=false;db.fault="after-commit";
        }
        return c.query(sql,params);
      },release:(destroy)=>c.release(destroy)
    };
  }};
  const dependencies={
    async lookupIdentity(p){identityCalls++;return {status:p===phone?(active?"active":"inactive"):"not_found",
      id:p===phone&&active?"SYNTHETIC-A":null};},
    async listActiveServices(){return catalog;},
    async classifyService(){
      const open=new Set();
      for(const call of db.calls){
        if(call.sql==="BEGIN")open.add(call.connection);
        if(call.sql==="COMMIT"||call.sql==="ROLLBACK")open.delete(call.connection);
      }
      assert.equal(open.size,0,"Gemini must run outside every transaction");
      return {serviceId:"1",classification:"clasificado"};
    }
  };
  const logs=[];
  let manager=createPersistentReception(dependencies,mutationPool,{now:()=>db.now});
  const post=createWebhookPost(()=>manager,{secret:()=>secret,logger:{
    info:(...v)=>logs.push(v),error:(...v)=>logs.push(v)}});
  let sequence=0;
  const send=async(text,id=`wamid.SYNTHETIC-C4-${++sequence}`,from=phone)=>{
    const r=await post({request:signedRequest(envelope([message(id,text,from)]))});
    return {status:r.status,body:await r.json(),id};
  };
  return {db,logs,send,post,identities:()=>identityCalls,setActive:v=>{active=v;},
    loseNextCommit:()=>{loseCommit=true;},
    restart(){manager.dispose();manager=createPersistentReception(dependencies,mutationPool,{now:()=>db.now});}};
}
async function draft(c){
  const prefix=[];
  for(const text of ["1","Pago semanal","06/11/2026",description]){
    const r=await c.send(text);assert.equal(r.status,200);prefix.push(message(r.id,text));
  }
  return prefix;
}
await test("HMAC RAW, ausente/incorrecta y payload malformado: cero identidad/SQL",async()=>{
  const c=fixture();
  assert.equal((await c.post({request:signedRequest(envelope([]),secret,false)})).status,401);
  assert.equal((await c.post({request:new Request("https://synthetic.invalid",{method:"POST",body:"{}"})})).status,401);
  assert.equal((await c.post({request:signedRequest("{")})).status,400);
  assert.equal((await c.post({request:signedRequest(envelope([
    message("same","confirmo"),{...message("bad","x"),id:undefined}
  ]))})).status,400);
  assert.equal(c.identities(),0);assert.equal(c.db.connections,0);
  assert.equal((await c.send("confirmo",undefined,"000000000000088")).status,200);
  c.setActive(false);await c.send("confirmo");assert.equal(c.db.connections,0);
});
await test("Resumen confirmado, lote duplicado y colision del mismo ID",async()=>{
  const c=fixture();await draft(c);assert.equal(c.db.snapshot().tickets.length,0);
  const event=message("wamid.SYNTHETIC-confirm","confirmo");
  assert.equal((await c.post({request:signedRequest(envelope([event,event]))})).status,200);
  assert.equal(c.db.snapshot().tickets.length,1);
  assert.equal((await c.send("confirmo",event.id)).status,200);
  assert.equal((await c.send("otro cuerpo",event.id)).status,503);
  assert.equal(c.db.snapshot().tickets.length,1);
});
await test("Reserva, reprogramacion, cancelacion, reintento antiguo y cierre expreso",async()=>{
  const c=fixture();await draft(c);await c.send("confirmo");await c.send("si");
  await c.send("1");const book=await c.send("confirmo");
  assert.equal(book.status,200);
  const first=c.db.snapshot().appointments[0];
  await c.send("reprogramar cita");await c.send("confirmo");await c.send("1");await c.send("confirmo");
  const moved=c.db.snapshot().appointments[0];assert.equal(first.id,moved.id);assert.notEqual(first.start,moved.start);
  assert.equal((await c.send("confirmo",book.id)).status,200);
  assert.equal(c.db.snapshot().appointments[0].start,moved.start);
  await c.send("cancelar cita");await c.send("confirmo");
  assert.equal(c.db.snapshot().tickets[0].status,"pendiente de cita");
  await c.send("sin cita");
  assert.equal(c.db.snapshot().tickets[0].status,"cerrado sin cita");
  assert.equal(c.db.snapshot().tickets[0].resolvedAt,null);
  assert.equal(c.db.snapshot().appointments[0].status,"CANCELADA");
});
await test("Lote parcial, fallo antes COMMIT, replay de prefijo y sufijo pendiente",async()=>{
  const c=fixture();const prefix=await draft(c);
  const batch=envelope([...prefix,...["confirmo","si","1","confirmo","consultar cita"]
    .map((text,i)=>message(`batch-${i}`,text))]);
  c.db.fault="receipt";
  assert.equal((await c.post({request:signedRequest(batch)})).status,503);
  assert.equal(c.db.snapshot().tickets.length,1);assert.equal(c.db.snapshot().appointments.length,0);
  assert.equal((await c.post({request:signedRequest(batch)})).status,200);
  assert.equal(c.db.snapshot().tickets.length,1);assert.equal(c.db.snapshot().appointments.length,1);
  assert.equal(c.db.snapshot().receipts.length,1);
  c.restart();
  assert.equal((await c.post({request:signedRequest(batch)})).status,200);
  assert.equal(c.db.snapshot().tickets.length,1);assert.equal(c.db.snapshot().appointments.length,1);
});
await test("COMMIT incierto, reinicio sin borrador y recuperacion durable simulada",async()=>{
  const c=fixture();await draft(c);c.loseNextCommit();
  const result=await c.send("confirmo");assert.equal(result.status,503);
  c.restart();assert.equal((await c.send("confirmo",result.id)).status,200);
  await c.send("agendar cita");await c.send("1");c.loseNextCommit();
  const booked=await c.send("confirmo");assert.equal(booked.status,503);
  c.restart();assert.equal((await c.send("confirmo",booked.id)).status,200);
  await c.send("consultar cita");
  assert.equal(c.db.snapshot().tickets.length,1);assert.equal(c.db.snapshot().appointments.length,1);
});
await test("Duplicado no renueva inactividad, borrador caduca exactamente a 120 minutos",async()=>{
  const c=fixture();await draft(c);
  const original=await c.send(description);c.db.now+=119*60000;
  await c.send(description,original.id);
  c.db.now+=60000;await c.send("confirmo");
  assert.equal(c.db.snapshot().tickets.length,0);
  c.restart();await c.send("confirmo");assert.equal(c.db.snapshot().tickets.length,0);
  const log=JSON.stringify(c.logs);assert(!log.includes(description));assert(!log.includes(phone));assert(!log.includes(secret));
});
console.log(`02-C4 E2E: ${groups} grupos PASS; SQL simulado, sin red ni envios.`);
