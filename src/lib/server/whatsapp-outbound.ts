/** Two gates: application approval AND explicit destination allowlist.
 * No application path currently supplies the approval capability.
 * Scheduled jobs only prepare; never call this transport automatically.
 */
export type OutboundMessage = {to:string;kind:"text";text:string;lastInboundAt:number} |
  {to:string;kind:"template";name:string;language:string;components?:unknown[]};
export async function sendWhatsApp(message:OutboundMessage,approval:{reviewed:true}|null=null,
  request:typeof fetch=fetch) {
  if(!approval?.reviewed||process.env.WHATSAPP_OUTBOUND_APPROVED!=="true")
    return {status:"BLOCKED" as const,reason:"Salida desactivada; requiere revisión y autorización explícita"};
  const allow=(process.env.WHATSAPP_OUTBOUND_ALLOWLIST??"").split(",").map(v=>v.trim());
  if(!/^\d{8,15}$/.test(message.to)||!allow.includes(message.to))throw new Error("DESTINATION_NOT_APPROVED");
  const token=process.env.WHATSAPP_ACCESS_TOKEN,phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID;
  if(!token||!phoneId||!/^\d+$/.test(phoneId))throw new Error("WHATSAPP_CONFIGURATION_REQUIRED");
  if(message.kind==="text"&&Date.now()-message.lastInboundAt>=24*3600000)throw new Error("APPROVED_TEMPLATE_REQUIRED");
  const body=message.kind==="text"?{type:"text",text:{body:message.text}}:
    {type:"template",template:{name:message.name,language:{code:message.language},components:message.components??[]}};
  const r=await request(`https://graph.facebook.com/v27.0/${phoneId}/messages`,{
    method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
    body:JSON.stringify({messaging_product:"whatsapp",to:message.to,...body})
  });
  if(!r.ok)throw new Error("WHATSAPP_SEND_UNCONFIRMED");
  return {status:"ACCEPTED" as const};
}
