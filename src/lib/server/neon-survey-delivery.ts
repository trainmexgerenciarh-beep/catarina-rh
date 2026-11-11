import {randomUUID} from "node:crypto";
import type pg from "pg";
import type {Claim,DeliveryRepository,DeliveryState} from "./survey-dispatcher.ts";

/** v1 is deliberately test-only. It must never be interpreted as real delivery.
 * A null column is unclaimed; fake receipts do NOT set enviada_en. */
export type DeliveryReceipt={
  v:1;mode:"FAKE_ONLY";state:DeliveryState;attempts:number;fence:number;
  nextAt:number;updatedAt:number;token?:string;leaseUntil?:number;
  code?:string;providerId?:string;
};
const states=["PENDIENTE","EN_CURSO","REINTENTAR","ACEPTADA","REVISION","DESCARTADA"];
export function parseDelivery(value:unknown):DeliveryReceipt|null{
  if(value===null)return null;
  const r=value as DeliveryReceipt;
  if(!r||typeof r!=="object"||Array.isArray(r)||r.v!==1||r.mode!=="FAKE_ONLY"||
    Object.keys(r).some(k=>!["v","mode","state","attempts","fence","nextAt","updatedAt","token","leaseUntil","code","providerId"].includes(k))||
    !states.includes(r.state)||![r.attempts,r.fence].every(x=>Number.isSafeInteger(x)&&x>=0)||
    ![r.nextAt,r.updatedAt].every(x=>Number.isSafeInteger(x)&&x>=0)||
    (r.token!==undefined&&!/^[a-f0-9-]{36}$/.test(r.token))||
    (r.leaseUntil!==undefined&&(!Number.isSafeInteger(r.leaseUntil)||r.leaseUntil<0))||
    (r.state==="EN_CURSO"&&(!r.token||!r.leaseUntil))||
    (r.code!==undefined&&!/^[A-Z0-9_]{1,80}$/.test(r.code))||
    (r.providerId!==undefined&&(typeof r.providerId!=="string"||r.providerId.length>512)))
    throw new Error("INVALID_DELIVERY_RECEIPT");
  return r;
}
async function transaction<T>(pool:pg.Pool,fn:(c:pg.PoolClient)=>Promise<T>):Promise<T>{
  const c=await pool.connect();let failed=false,committing=false;
  try{
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='3s'");
    await c.query("SET LOCAL statement_timeout='8s'");
    const result=await fn(c);committing=true;await c.query("COMMIT");return result;
  }catch(e){failed=committing;try{await c.query("ROLLBACK");}catch{failed=true;}throw e;}
  finally{c.release(failed);}
}
const clock=async(c:pg.PoolClient)=>Number((await c.query(
  "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS now")).rows[0].now);

/** Short row-lock transactions, SKIP LOCKED, DB clock AFTER acquiring locks.
 * No external call, Gemini, or provider acknowledgment is made under a lock.
 * Lease expiry is uncertain -> manual review, NEVER automatic re-send. */
export function createNeonSurveyDelivery(pool:pg.Pool):DeliveryRepository{
  return {
    async claim(_untrustedClock):Promise<Claim|null>{
      return transaction(pool,async c=>{
        const rows=(await c.query(`SELECT e.id_encuesta::text,e.entrega,
          a.id_cita::text,a.id_ticket::text,a.inicio_programado,a.estado,
          s.categoria,w.whatsapp,w.activo,e.respondida_en
          FROM public.encuestas e JOIN public.citas a USING(id_cita)
          JOIN public.tickets t USING(id_ticket)
          JOIN public.colaboradores w USING(id_colaborador)
          JOIN public.servicios s USING(id_servicio)
          WHERE w.whatsapp ~ '^0[0-9]{7,14}$' AND e.enviada_en IS NULL
          AND (e.entrega IS NULL OR e.entrega->>'state' IN ('PENDIENTE','REINTENTAR','EN_CURSO'))
          AND (e.entrega IS NULL OR e.entrega->>'state'='EN_CURSO'
            OR CASE WHEN e.entrega->>'nextAt' ~ '^[0-9]{1,16}$'
              THEN (e.entrega->>'nextAt')::numeric <= extract(epoch FROM clock_timestamp())*1000
              ELSE TRUE END)
          ORDER BY e.id_encuesta LIMIT 100 FOR UPDATE OF e SKIP LOCKED`)).rows;
        const now=await clock(c);
        for(const row of rows){
          const old=parseDelivery(row.entrega);
          if(old?.state==="EN_CURSO"){
            if(old.leaseUntil!<=now){
              const review={...old,state:"REVISION",code:"LEASE_EXPIRED_OUTCOME_UNKNOWN",updatedAt:now};
              await c.query("UPDATE public.encuestas SET entrega=$2::jsonb WHERE id_encuesta=$1",
                [row.id_encuesta,JSON.stringify(review)]);
            }
            continue;
          }
          if(old&&old.nextAt>now)continue;
          if(old&&old.attempts>=3){
            await c.query("UPDATE public.encuestas SET entrega=$2::jsonb WHERE id_encuesta=$1",
              [row.id_encuesta,JSON.stringify({...old,state:"REVISION",code:"ATTEMPT_BUDGET_EXHAUSTED",updatedAt:now})]);
            continue;
          }
          const token=randomUUID();
          const receipt:DeliveryReceipt={v:1,mode:"FAKE_ONLY",state:"EN_CURSO",
            attempts:(old?.attempts??0)+1,fence:(old?.fence??0)+1,
            nextAt:now,updatedAt:now,token,leaseUntil:now+60_000};
          await c.query("UPDATE public.encuestas SET entrega=$2::jsonb WHERE id_encuesta=$1",
            [row.id_encuesta,JSON.stringify(receipt)]);
          return {id:row.id_encuesta,appointmentId:row.id_cita,ticketId:row.id_ticket,
            to:row.whatsapp,scheduledAt:new Date(row.inicio_programado).getTime(),
            appointmentState:row.estado,category:row.categoria,active:row.activo,
            answered:row.respondida_en!==null,state:"EN_CURSO",attempts:receipt.attempts,
            nextAt:now,token,leaseUntil:receipt.leaseUntil};
        }
        return null;
      });
    },
    async settle(id,token,result){
      await transaction(pool,async c=>{
        const row=(await c.query(`SELECT entrega FROM public.encuestas
          WHERE id_encuesta=$1 FOR UPDATE`,[id])).rows[0];
        const old=row?parseDelivery(row.entrega):null;
        if(!old||old.token!==token||!["EN_CURSO","REVISION"].includes(old.state))
          throw new Error("DELIVERY_FENCE_CONFLICT");
        if(!["REINTENTAR","ACEPTADA","REVISION","DESCARTADA"].includes(result.state)||
          (result.state==="ACEPTADA"&&!result.providerId)||
          (result.state==="REINTENTAR"&&old.attempts>=3))
          throw new Error("INVALID_DELIVERY_TRANSITION");
        const now=await clock(c);
        // Caller clock may be skewed: retry schedule is always computed by DB.
        const next:DeliveryReceipt={...old,state:result.state,code:result.code,
          updatedAt:now,nextAt:result.state==="REINTENTAR"?now+60_000*2**(old.attempts-1):now};
        delete next.leaseUntil;
        if(result.providerId)next.providerId=result.providerId;
        parseDelivery(next);
        await c.query("UPDATE public.encuestas SET entrega=$2::jsonb WHERE id_encuesta=$1",
          [id,JSON.stringify(next)]);
      });
    }
  };
}
