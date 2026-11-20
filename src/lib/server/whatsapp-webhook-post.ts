import { createHash,createHmac, timingSafeEqual } from "node:crypto";
import { requireEventId } from "./persistence-unit.ts";
import { summarizeConversationResults } from "./whatsapp-conversation.js";
import type { createPayrollReception } from "./payroll-reception.ts";
import { sendWhatsApp } from "./whatsapp-outbound.ts";
import { prepareWhatsAppReply,readInteractiveSelection } from "./whatsapp-interactive.ts";

type Manager = Pick<ReturnType<typeof createPayrollReception>,"handleMessage"> & {
  handleUnsupported?:(phone:string,type:string,hash:string,eventId:string)=>ReturnType<ReturnType<typeof createPayrollReception>["handleMessage"]>;
};
function record(value: unknown): value is Record<string,unknown> {
  return typeof value==="object" && value!==null && !Array.isArray(value);
}
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):record(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
/** Full-batch validation before any identity lookup or business operation.
 * Delivery statuses are acknowledged; unsupported media are journaled as
 * technical events only, without download, transcription or business effects.
 */
function incoming(payload: unknown) {
  if(!record(payload)||payload.object!=="whatsapp_business_account"||!Array.isArray(payload.entry))
    throw new Error("Invalid envelope");
  const messages:{phone:string;text:string;key:string;lastInboundAt?:number;unsupported?:{type:string;hash:string}}[]=[];
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
        if(typeof m.from!=="string"||!/^\d+$/.test(m.from)||typeof m.id!=="string")
          throw new Error("Invalid message envelope");
        requireEventId(m.id);
        const lastInboundAt=typeof m.timestamp==="string"&&/^\d{1,12}$/.test(m.timestamp)&&
          Number.isSafeInteger(Number(m.timestamp))?Number(m.timestamp)*1000:undefined;
        if(m.type==="interactive"){
          const text=readInteractiveSelection(m);
          if(!text?.trim())throw new Error("Invalid interactive reply");
          const item={phone:m.from,text,key:m.id,lastInboundAt};
          const prior=seen.get(m.id);
          if(prior&&(prior.phone!==item.phone||prior.text!==item.text))throw new Error("Conflicting batch event");
          if(!prior){seen.set(m.id,item);messages.push(item);}
          continue;
        }
        if(m.type!=="text"){
          const hash=createHash("sha256").update(JSON.stringify(canonical(m))).digest("hex");
          const item={phone:m.from,text:`[unsupported:${m.type}:${hash}]`,key:m.id,lastInboundAt,
            unsupported:{type:m.type,hash}};
          const prior=seen.get(m.id);
          if(prior&&(prior.phone!==item.phone||prior.text!==item.text))throw new Error("Conflicting batch event");
          if(!prior){seen.set(m.id,item);messages.push(item);}
          continue;
        }
        if(!record(m.text)||typeof m.text.body!=="string"||!m.text.body.trim())
          throw new Error("Invalid text message");
        const item={phone:m.from,text:m.text.body,key:m.id,lastInboundAt};
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
  outboundEnabled?:()=>boolean;
  send?:(message:Parameters<typeof sendWhatsApp>[0])=>ReturnType<typeof sendWhatsApp>;
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
      for(const m of messages){
        const manager=getManager();
        if(m.unsupported){
          results.push(manager.handleUnsupported
            ?await manager.handleUnsupported(m.phone,m.unsupported.type,m.unsupported.hash,m.key)
            :{collaboratorStatus:"active",classification:null,action:"unsupported_message",
              reply:"Para continuar, envía una respuesta de texto."});
        }else results.push(await manager.handleMessage(m.phone,m.text,m.key));
      }
    }catch{
      logger.error("[whatsapp-webhook] Processing incomplete",{
        completed:results.length,total:messages.length,mode:"SIMULATION_ONLY",outbound:false
      });
      return Response.json({received:false,error:"Message processing unavailable"},{status:503});
    }
    // A webhook acknowledgement is not proof that an employee received a reply.
    // Live replies require a second explicit feature switch in addition to the
    // transport's approval flag and exact-recipient allowlist.
    const outboundEnabled=(options.outboundEnabled??(()=>process.env.WHATSAPP_WEBHOOK_REPLY_ENABLED==="true"&&
      process.env.WHATSAPP_OUTBOUND_APPROVED==="true"))();
    if(outboundEnabled){
      let acceptedByMeta=0,skipped=0;
      try{
        for(let i=0;i<results.length;i++){
          const result=results[i];
          if(result.collaboratorStatus!=="active"||
            ["durable_replay","duplicate_ignored","ignored"].includes(result.action)||
            !result.reply.trim()){
            skipped++;continue;
          }
          const outgoing=prepareWhatsAppReply(messages[i].phone,result,messages[i].lastInboundAt??Number.NaN);
          const receipt=await (options.send??(m=>sendWhatsApp(m,{reviewed:true})))(outgoing);
          if(receipt.status!=="ACCEPTED")throw new Error("Outbound was not accepted");
          acceptedByMeta++;
        }
      }catch{
        logger.error("[whatsapp-webhook] Reply delivery not confirmed",{
          processed:results.length,acceptedByMeta,mode:"LIVE_GATE_ENABLED"
        });
        return Response.json({received:true,processing:"completed",outbound:"not_confirmed"},
          {status:503,headers:{"cache-control":"no-store"}});
      }
      const outbound=acceptedByMeta?"accepted_by_meta":"not_sent";
      logger.info("[whatsapp-webhook] Reception and reply completed",{
        ...summarizeConversationResults(results),outbound,acceptedByMeta,skipped
      });
      return Response.json({received:true,processing:"completed",outbound,acceptedByMeta,skipped},
        {headers:{"cache-control":"no-store"}});
    }
    // Default: no Graph request, regardless of credentials being present.
    logger.info("[whatsapp-webhook] Reception completed",{
      ...summarizeConversationResults(results),mode:"SIMULATION_ONLY",outbound:false
    });
    return Response.json({received:true,processing:"completed",outbound:"OFF"},
      {headers:{"cache-control":"no-store"}});
  };
}
