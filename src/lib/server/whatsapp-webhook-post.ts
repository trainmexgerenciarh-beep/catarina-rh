import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEventId } from "./persistence-unit.ts";
import { summarizeConversationResults } from "./whatsapp-conversation.js";
import type { createPayrollReception } from "./payroll-reception.ts";

type Manager = Pick<ReturnType<typeof createPayrollReception>,"handleMessage">;
function record(value: unknown): value is Record<string,unknown> {
  return typeof value==="object" && value!==null && !Array.isArray(value);
}
/** Full-batch validation before any identity lookup or business operation.
 * Delivery/status/non-text notifications are acknowledged without business SQL.
 */
function incoming(payload: unknown) {
  if(!record(payload)||payload.object!=="whatsapp_business_account"||!Array.isArray(payload.entry))
    throw new Error("Invalid envelope");
  const messages:{phone:string;text:string;key:string}[]=[];
  const seen=new Map<string,{phone:string;text:string}>();
  for(const entry of payload.entry){
    if(!record(entry)||!Array.isArray(entry.changes))throw new Error("Invalid entry");
    for(const change of entry.changes){
      if(!record(change))throw new Error("Invalid change");
      if(change.field!=="messages")continue;
      if(!record(change.value))throw new Error("Invalid value");
      if(change.value.messages===undefined)continue;
      if(!Array.isArray(change.value.messages))throw new Error("Invalid messages");
      for(const m of change.value.messages){
        if(!record(m))throw new Error("Invalid message");
        if(typeof m.type!=="string")throw new Error("Invalid type");
        if(m.type!=="text")continue;
        if(typeof m.from!=="string"||!/^\d+$/.test(m.from)||!record(m.text)||
          typeof m.text.body!=="string"||!m.text.body.trim()||typeof m.id!=="string")
          throw new Error("Invalid text message");
        requireEventId(m.id);
        const item={phone:m.from,text:m.text.body,key:m.id};
        const prior=seen.get(m.id);
        if(prior && (prior.phone!==item.phone||prior.text!==item.text))
          throw new Error("Conflicting batch event");
        if(!prior){seen.set(m.id,item);messages.push(item);}
      }
    }
  }
  return messages;
}

// Same HMAC-SHA256 validation over RAW bytes and timingSafeEqual as before C4.
function isValidSignature(rawBody:Buffer,header:string|null,secret:string) {
  if(!header||!/^sha256=[a-f0-9]{64}$/i.test(header))return false;
  const received=Buffer.from(header.slice("sha256=".length),"hex");
  const expected=createHmac("sha256",secret).update(rawBody).digest();
  return received.length===expected.length && timingSafeEqual(received,expected);
}
export function createWebhookPost(getManager:()=>Manager, options:{
  secret?:()=>string|undefined;logger?:Pick<Console,"info"|"error">;
}={}) {
  const logger=options.logger??console;
  return async ({request}:{request:Request})=>{
    const appSecret=(options.secret??(()=>process.env.WHATSAPP_APP_SECRET))();
    if(!appSecret)return Response.json({received:false,error:"Webhook not configured"},{status:503});
    const rawBody=Buffer.from(await request.arrayBuffer());
    if(!isValidSignature(rawBody,request.headers.get("x-hub-signature-256"),appSecret))
      return Response.json({received:false,error:"Invalid webhook signature"},{status:401});
    let messages;
    try {messages=incoming(JSON.parse(rawBody.toString("utf8")));}
    catch{return Response.json({received:false,error:"Invalid webhook payload"},{status:400});}
    const results:Awaited<ReturnType<Manager["handleMessage"]>>[]=[];
    try {
      // Fail-fast. Re-delivery replays committed effects, skips seen draft events
      // without extending TTL and resumes the failed/not-yet-processed suffix.
      for(const m of messages)results.push(await getManager().handleMessage(m.phone,m.text,m.key));
    }catch{
      logger.error("[whatsapp-webhook] Processing incomplete",{
        completed:results.length,total:messages.length,mode:"SIMULATION_ONLY",outbound:false
      });
      return Response.json({received:false,error:"Message processing unavailable"},{status:503});
    }
    // Prepared replies are discarded, never serialized/logged/sent.
    logger.info("[whatsapp-webhook] Reception completed",{
      ...summarizeConversationResults(results),mode:"SIMULATION_ONLY",outbound:false
    });
    return Response.json({received:true});
  };
}
