import {randomUUID} from "node:crypto";
import {localDate} from "./agenda-time.ts";
export type DeliveryState="PENDIENTE"|"EN_CURSO"|"REINTENTAR"|"ACEPTADA"|"REVISION"|"DESCARTADA";
export type SurveyJob={
  id:string;appointmentId:string;ticketId:string;to:string;scheduledAt:number;
  appointmentState:string;category:string;active:boolean;answered:boolean;
  lastInboundAt?:number;state:DeliveryState;attempts:number;nextAt:number;
  token?:string;leaseUntil?:number;providerId?:string;code?:string;
};
export type Claim=SurveyJob&{token:string};
export interface DeliveryRepository{
  claim(now:number):Promise<Claim|null>;
  settle(id:string,token:string,result:{state:DeliveryState;code:string;providerId?:string;nextAt?:number}):Promise<void>;
}
export type TestDelivery={kind:"text";to:string;text:string}|{kind:"template";to:string;name:string;language:string;appointmentDate:string};
export type DeliveryResult={status:"ACCEPTED";messageId:string}|{status:"RETRYABLE"|"PERMANENT"|"UNKNOWN";code:string};
/** This release ONLY supports an explicitly injected fictitious transport.
 * No live Graph client is imported here. PostgreSQL and memory repositories
 * share this test-only contract; acceptance here is NOT real WhatsApp delivery.
 */
export function createSurveyDispatcher(repository:DeliveryRepository,transport:{
  mode:"FAKE_ONLY";send(message:TestDelivery):Promise<DeliveryResult>
},options:{now?:()=>number;template:string;language:string}){
  if(transport.mode!=="FAKE_ONLY")throw new Error("LIVE_DISPATCH_DISABLED");
  const now=options.now??Date.now;
  return {async run(limit=50){
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error("INVALID_BATCH");
    if(!/^[a-z0-9_]+$/.test(options.template))throw new Error("APPROVED_TEMPLATE_REQUIRED");
    let accepted=0,review=0,retry=0,discarded=0;
    for(let n=0;n<limit;n++){
      const job=await repository.claim(now());if(!job)break;
      const finish=(r:Parameters<DeliveryRepository["settle"]>[2])=>repository.settle(job.id,job.token,r);
      const eligible=job.active&&!job.answered&&job.appointmentState!=="CANCELADA"&&
        ["Nómina y prestaciones","Políticas y procedimientos"].includes(job.category)&&
        Number.isFinite(job.scheduledAt)&&localDate(job.scheduledAt)<localDate(now());
      if(!eligible){await finish({state:"DESCARTADA",code:"NOT_ELIGIBLE"});discarded++;continue;}
      // Hard safety: the test dispatcher refuses every E.164-real destination.
      if(!/^0\d{7,14}$/.test(job.to)){await finish({state:"REVISION",code:"NON_FICTITIOUS_DESTINATION_BLOCKED"});review++;continue;}
      const within=Number.isFinite(job.lastInboundAt)&&job.lastInboundAt!<=now()&&now()-job.lastInboundAt!<24*3600000;
      const message:TestDelivery=within?
        {kind:"text",to:job.to,text:"¿Recibiste atención en tu cita de RH? Responde «encuesta» para compartir tu experiencia."}:
        {kind:"template",to:job.to,name:options.template,language:options.language,appointmentDate:localDate(job.scheduledAt)};
      let result:DeliveryResult;
      try{result=await transport.send(message);}catch{result={status:"UNKNOWN",code:"TRANSPORT_OUTCOME_UNKNOWN"};}
      if(result.status==="ACCEPTED"){
        if(!result.messageId){await finish({state:"REVISION",code:"MISSING_PROVIDER_RECEIPT"});review++;}
        else{await finish({state:"ACEPTADA",code:"PROVIDER_ACCEPTED",providerId:result.messageId});accepted++;}
      }else if(result.status==="RETRYABLE"&&job.attempts<3){
        await finish({state:"REINTENTAR",code:result.code,nextAt:now()+60_000*2**(job.attempts-1)});retry++;
      }else{
        const state=result.status==="PERMANENT"?"DESCARTADA":"REVISION";
        await finish({state,code:result.code});state==="REVISION"?review++:discarded++;
      }
    }
    return {mode:"SIMULATION_ONLY",accepted,review,retry,discarded,realOutbound:false};
  }};
}
/** Isolated test repository. NOT a substitute for PostgreSQL durability. */
export class MemoryDeliveryRepository implements DeliveryRepository{
  private rows=new Map<string,SurveyJob>();
  constructor(fixtures:SurveyJob[]){for(const r of fixtures){if(this.rows.has(r.id))throw new Error("DUPLICATE_SURVEY");this.rows.set(r.id,structuredClone(r));}}
  async claim(now:number):Promise<Claim|null>{
    for(const r of this.rows.values()){
      if(r.state==="EN_CURSO"&&r.leaseUntil!<=now){r.state="REVISION";r.code="LEASE_EXPIRED_OUTCOME_UNKNOWN";continue;}
      if(!["PENDIENTE","REINTENTAR"].includes(r.state)||r.nextAt>now)continue;
      r.state="EN_CURSO";r.token=randomUUID();r.leaseUntil=now+60_000;r.attempts++;
      return structuredClone(r) as Claim;
    }return null;
  }
  async settle(id:string,token:string,result:Parameters<DeliveryRepository["settle"]>[2]){
    const r=this.rows.get(id);
    if(!r||r.token!==token||!["EN_CURSO","REVISION"].includes(r.state))throw new Error("DELIVERY_FENCE_CONFLICT");
    Object.assign(r,{...result,nextAt:result.nextAt??r.nextAt,leaseUntil:undefined});
  }
  snapshot(){return structuredClone([...this.rows.values()]);}
}
