/** Two gates: application approval AND explicit destination allowlist.
 * No application path currently supplies the approval capability.
 * Scheduled jobs only prepare; never call this transport automatically.
 */
export type OutboundMessage = {to:string;kind:"text";text:string;lastInboundAt:number} |
  {to:string;kind:"template";name:string;language:string;components?:unknown[]};
export class OutboundFailure extends Error{
  certainty:"RETRYABLE_REJECTED"|"PERMANENT_REJECTED"|"UNKNOWN";
  httpStatus:number|null;
  constructor(certainty:"RETRYABLE_REJECTED"|"PERMANENT_REJECTED"|"UNKNOWN",httpStatus:number|null=null){
    super("WHATSAPP_SEND_NOT_CONFIRMED");this.name="OutboundFailure";this.certainty=certainty;this.httpStatus=httpStatus;
  }
}
export async function sendWhatsApp(message:OutboundMessage,approval:{reviewed:true}|null=null,
  request:typeof fetch=fetch) {
  if(!approval?.reviewed||process.env.WHATSAPP_OUTBOUND_APPROVED!=="true")
    return {status:"BLOCKED" as const,reason:"Salida desactivada; requiere revisión y autorización explícita"};
  const allow=(process.env.WHATSAPP_OUTBOUND_ALLOWLIST??"").split(",").map(v=>v.trim());
  if(!/^\d{8,15}$/.test(message.to)||!allow.includes(message.to))throw new Error("DESTINATION_NOT_APPROVED");
  const token=process.env.WHATSAPP_ACCESS_TOKEN,phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID;
  if(!token||!phoneId||!/^\d+$/.test(phoneId))throw new Error("WHATSAPP_CONFIGURATION_REQUIRED");
  if(message.kind==="text"&&(!Number.isFinite(message.lastInboundAt)||message.lastInboundAt>Date.now()||
    Date.now()-message.lastInboundAt>=24*3600000))throw new Error("APPROVED_TEMPLATE_REQUIRED");
  if(message.kind==="template"&&(!/^[a-z0-9_]+$/.test(message.name)||!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(message.language)))
    throw new Error("INVALID_TEMPLATE_CONFIGURATION");
  const body=message.kind==="text"?{type:"text",text:{body:message.text}}:
    {type:"template",template:{name:message.name,language:{code:message.language},components:message.components??[]}};
  let r:Response;
  try{r=await request(`https://graph.facebook.com/v27.0/${phoneId}/messages`,{
      method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      redirect:"error",signal:AbortSignal.timeout(10000),
      body:JSON.stringify({messaging_product:"whatsapp",to:message.to,...body})
    });}catch{throw new OutboundFailure("UNKNOWN");}
  if(!r.ok)throw new OutboundFailure(r.status===429?"RETRYABLE_REJECTED":r.status>=400&&r.status<500&&r.status!==408?
    "PERMANENT_REJECTED":"UNKNOWN",r.status);
  let result:unknown;
  try{result=await r.json();}catch{throw new OutboundFailure("UNKNOWN",r.status);}
  const receipt=(result as {messages?:{id?:unknown}[]})?.messages?.[0]?.id;
  if(typeof receipt!=="string"||!receipt)throw new OutboundFailure("UNKNOWN",r.status);
  return {status:"ACCEPTED" as const,messageId:receipt};
}
