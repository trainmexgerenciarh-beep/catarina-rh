import type pg from "pg";
import {inAgendaTransaction} from "./persistence-unit.ts";
import {prepareSurveys} from "./rh-service.ts";
/** A resident-process catch-up worker, NOT an outbound scheduler.
 * DB locks make competing instances safe. Hosting suspension delays execution;
 * on resumption the durable due-date predicate catches up, without fake sends.
 */
export function startMaintenance(pool:pg.Pool,options:{
  schedule?:(run:()=>void)=>()=>void;onError?:()=>void;
}={}) {
  let running=false,disposed=false;
  const run=async()=>{
    if(running||disposed)return;
    running=true;
    try{
      await inAgendaTransaction(pool,async c=>{
        await c.query(`DELETE FROM public.contextos_conversacion WHERE (canal,id_colaborador) IN
          (SELECT canal,id_colaborador FROM public.contextos_conversacion
           WHERE vence_en<=clock_timestamp() AND (lease_hasta IS NULL OR lease_hasta<=clock_timestamp())
           ORDER BY vence_en LIMIT 100 FOR UPDATE SKIP LOCKED)`);
      });
      await prepareSurveys(pool);
    }catch{options.onError?.();}
    finally{running=false;}
  };
  const stop=options.schedule?options.schedule(()=>{void run();}):(()=>{
    const timer=setInterval(()=>{void run();},60_000);timer.unref();return ()=>clearInterval(timer);
  })();
  return {run,dispose(){disposed=true;stop();}};
}
