import assert from"node:assert/strict";
import{createWebhookPost}from"../src/lib/server/whatsapp-webhook-post.ts";
import{prepareWhatsAppReply,readInteractiveSelection}from"../src/lib/server/whatsapp-interactive.ts";
import{sendWhatsApp}from"../src/lib/server/whatsapp-outbound.ts";

let groups=0;const pass=name=>{groups++;console.log(name+": PASS");};
const choiceMessage={from:"000000000000001",id:"wamid.SYNTHETIC-choice",type:"interactive",
  interactive:{type:"list_reply",list_reply:{id:"catarina:2",title:"Horas extra"}}};
assert.equal(readInteractiveSelection(choiceMessage),"2");
assert.equal(readInteractiveSelection({...choiceMessage,interactive:{type:"button_reply",
  button_reply:{id:"catarina:confirm",title:"Confirmar"}}}),"confirmo");
assert.equal(readInteractiveSelection({...choiceMessage,interactive:{type:"button_reply",
  button_reply:{id:"other:choice",title:"Otra opción"}}}),"Otra opción");
pass("Respuestas interactivas de botón y lista vuelven a la misma selección del motor");

const menu=prepareWhatsAppReply("000000000000001",{action:"menu",reply:
  "Menú principal:\n1. Tengo un problema con mi pago.\n2. Tengo una duda sobre reglas de RH.\n3. Tu Voz en Trainmex: Quejas e Ideas de Mejora.\n4. Consultar, cancelar o cambiar una cita programada."});
assert.equal(menu.kind,"interactive");assert.equal(menu.interactive.type,"list");
assert.equal(menu.interactive.rows.length,4);assert.equal(menu.interactive.rows[2].id,"catarina:3");
assert.equal(menu.interactive.rows[0].title,"Tengo un problema con mi");
const friday=prepareWhatsAppReply("000000000000001",{action:"payroll_friday",
  reply:"¿De qué viernes fue el pago: el pasado, el antepasado o alguna otra fecha?"});
assert.equal(friday.kind,"interactive");assert.equal(friday.interactive.type,"button");
assert.equal(friday.interactive.buttons.length,3);
const summary=prepareWhatsAppReply("000000000000001",{action:"payroll_summary",
  reply:"Revisa si lo entendí bien:\nTema: Horas extra\n¿Lo registro para que RH lo revise?"});
assert.equal(summary.interactive.buttons[0].id,"catarina:confirm");
for(const action of ["payroll_ticket_created","policy_ticket","offer"]){
  const prompt=prepareWhatsAppReply("000000000000001",{action,reply:"¿Deseas solicitar una cita con RH?"});
  assert.equal(prompt.kind,"interactive");assert.equal(prompt.interactive.type,"button");
  assert.equal(prompt.interactive.buttons.length,2);
}
const slots=prepareWhatsAppReply("000000000000001",{action:"remote_time_options",
  reply:"Horarios disponibles para viernes:\n1. 20/11/2026 14:00–14:20 (America/Mexico_City)\n2. 20/11/2026 14:20–14:40 (America/Mexico_City)\nElige un horario."});
assert.equal(slots.interactive.type,"button");
assert.equal(slots.interactive.buttons[0].title,"20/11 14:00-14:20");
pass("Menú, fecha, resumen y horarios se presentan como listas o botones breves compatibles");

const old={...process.env};
try{
  process.env.WHATSAPP_OUTBOUND_APPROVED="true";
  process.env.WHATSAPP_OUTBOUND_ALLOWLIST="000000000000001";
  process.env.WHATSAPP_ACCESS_TOKEN="SYNTHETIC-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID="123456";
  let calls=0,requestBody;
  const request=async(_url,init)=>{calls++;requestBody=JSON.parse(init.body);
    return Response.json({messages:[{id:"wamid.SYNTHETIC-outbound"}]});};
  assert.equal((await sendWhatsApp({to:"000000000000001",kind:"text",text:"Prueba",
    lastInboundAt:Date.now()},null,request)).status,"BLOCKED");
  assert.equal(calls,0,"sin capacidad explícita no se realiza ninguna llamada");
  const accepted=await sendWhatsApp(menu,{reviewed:true},request);
  assert.equal(accepted.status,"ACCEPTED");assert.equal(calls,1);
  assert.equal(requestBody.type,"interactive");assert.equal(requestBody.interactive.type,"list");
  await assert.rejects(sendWhatsApp({...menu,to:"000000000000002"},{reviewed:true},request),
    /DESTINATION_NOT_APPROVED/);
  assert.equal(calls,1);
  await assert.rejects(sendWhatsApp({...menu,lastInboundAt:Date.now()-24*3600000},
    {reviewed:true},request),/APPROVED_TEMPLATE_REQUIRED/);
  pass("Transporte Graph simulado valida aprobación, allowlist, ventana y acuse del proveedor");
}finally{
  for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];
  for(const[key,value]of Object.entries(old))process.env[key]=value;
}

const logs=[],sent=[];
let nextAction="menu";
const receivedInputs=[];
const manager={async handleMessage(_phone,text){
  receivedInputs.push(text);
  if(text==="durable")return {collaboratorStatus:"active",action:"durable_replay",reply:"Ya procesado."};
  if(text==="hola")return {collaboratorStatus:"active",action:"menu",reply:
    "Menú principal:\n1. Tengo un problema con mi pago.\n2. Tengo una duda sobre reglas de RH.\n3. Tu Voz en Trainmex: Quejas e Ideas de Mejora.\n4. Consultar, cancelar o cambiar una cita programada."};
  return {collaboratorStatus:"active",action:nextAction,reply:text};
},async handleUnsupported(){return {collaboratorStatus:"active",action:"unsupported_message",reply:"Envía texto."};}};
const secret="SYNTHETIC-HMAC-ONLY";
const {createHmac}=await import("node:crypto");
function signed(messages){
  const withTimestamp=messages.map(m=>({...m,timestamp:String(Math.floor(Date.now()/1000))}));
  const body=JSON.stringify({object:"whatsapp_business_account",entry:[{changes:[
    {field:"messages",value:{messages:withTimestamp}}
  ]}]});
  const signature=createHmac("sha256",secret).update(body).digest("hex");
  return new Request("https://synthetic.invalid/webhook",{method:"POST",body,
    headers:{"x-hub-signature-256":`sha256=${signature}`}});
}
const post=createWebhookPost(()=>manager,{secret:()=>secret,
  outboundEnabled:()=>true,send:async message=>{sent.push(message);return {status:"ACCEPTED",messageId:"synthetic"};},
  logger:{info:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}});
let response=await post({request:signed([{id:"wamid.SYNTHETIC-menu",from:"000000000000001",
  type:"text",text:{body:"hola"}}])});
assert.equal(response.status,200);assert.equal((await response.json()).outbound,"accepted_by_meta");
assert.equal(sent.at(-1).kind,"interactive");
response=await post({request:signed([choiceMessage])});
assert.equal(response.status,200);assert.equal(sent.at(-1).to,"000000000000001");
assert.equal(receivedInputs.at(-1),"2");
response=await post({request:signed([{id:"wamid.SYNTHETIC-replay",from:"000000000000001",
  type:"text",text:{body:"durable"}}])});
assert.equal(response.status,200);const replayBody=await response.json();
assert.equal(replayBody.skipped,1);assert.equal(replayBody.outbound,"not_sent");
const beforeReplay=sent.length;
response=await post({request:signed([{...choiceMessage,id:"wamid.SYNTHETIC-invalid-choice",
  interactive:{type:"button_reply",button_reply:{id:"",title:""}}}])});
assert.equal(response.status,400);assert.equal(sent.length,beforeReplay);
pass("Webhook firmado procesa selección, ignora replay sin nuevo envío y rechaza botón malformado");

const gateBefore={approval:process.env.WHATSAPP_OUTBOUND_APPROVED,
  reply:process.env.WHATSAPP_WEBHOOK_REPLY_ENABLED};
let blockedCalls=0;
try{
  process.env.WHATSAPP_OUTBOUND_APPROVED="true";
  delete process.env.WHATSAPP_WEBHOOK_REPLY_ENABLED;
  const gated=createWebhookPost(()=>manager,{secret:()=>secret,
    send:async()=>{blockedCalls++;return{status:"ACCEPTED",messageId:"synthetic"};},
    logger:{info:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}});
  response=await gated({request:signed([{id:"wamid.SYNTHETIC-default-off",from:"000000000000001",
    type:"text",text:{body:"hola"} }])});
  assert.equal(response.status,200);assert.equal((await response.json()).outbound,"OFF");
  assert.equal(blockedCalls,0,"el switch específico del webhook también debe estar activado");
}finally{
  if(gateBefore.approval===undefined)delete process.env.WHATSAPP_OUTBOUND_APPROVED;
  else process.env.WHATSAPP_OUTBOUND_APPROVED=gateBefore.approval;
  if(gateBefore.reply===undefined)delete process.env.WHATSAPP_WEBHOOK_REPLY_ENABLED;
  else process.env.WHATSAPP_WEBHOOK_REPLY_ENABLED=gateBefore.reply;
}
pass("Un secreto de aprobación presente no basta: el segundo switch mantiene salida apagada");

const failurePost=createWebhookPost(()=>manager,{secret:()=>secret,outboundEnabled:()=>true,
  send:async()=>{throw new Error("synthetic-transport-failure");},
  logger:{info:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}});
response=await failurePost({request:signed([{id:"wamid.SYNTHETIC-send-failure",from:"000000000000001",
  type:"text",text:{body:"consulta ficticia"}}])});
assert.equal(response.status,503);
assert.deepEqual(await response.json(),{received:true,processing:"completed",outbound:"not_confirmed"});
assert(!JSON.stringify(logs).includes("consulta ficticia"));
pass("Falla o acuse incierto devuelve 503 y estado no confirmado, nunca éxito de entrega");
console.log(`WHATSAPP OUTBOUND: ${groups} grupos PASS; sin red ni Meta real.`);
