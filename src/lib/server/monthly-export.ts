import type pg from "pg";
import {ReplitConnectors} from "@replit/connectors-sdk";
import {PersistenceError} from "./persistence-unit.ts";
const connectors=new ReplitConnectors();
const safeCell=(v:unknown)=>{const s=String(v??"");return /^[=+\-@\t\r]/.test(s)?"'"+s:s;};
/** A dedicated month sheet plus stable ticket ID deduplicates lost acknowledgements.
 * Session advisory lock protects concurrent exporters without a long DB transaction.
 */
export async function exportMonth(pool:pg.Pool,month:string,options:{
  proxy?:(path:string,init:{method:"GET"|"POST";body?:string})=>Promise<Response>
}={}) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new PersistenceError("INVALID_MONTH");
  const target=process.env.RH_EXPORT_SPREADSHEET_ID;
  if(!target||!/^[A-Za-z0-9_-]+$/.test(target))throw new PersistenceError("SHEETS_DESTINATION_REQUIRED");
  const c=await pool.connect(),title=`Tickets_${month.replace("-","_")}`;
  const proxy=options.proxy??((path,init)=>connectors.proxy("google-sheet",path,{...init,signal:AbortSignal.timeout(20_000)}));
  let locked=false;
  try {
    await c.query("SELECT pg_advisory_lock(2026111002)");locked=true;
    const base=`/v4/spreadsheets/${target}`;
    const meta=await proxy(base+"?fields=sheets.properties.title",{method:"GET"});
    if(!meta.ok)throw new PersistenceError("SHEETS_PERMISSION_REQUIRED");
    const info=await meta.json() as {sheets?:{properties:{title:string}}[]};
    if(!info.sheets?.some(s=>s.properties.title===title)){
      const created=await proxy(base+":batchUpdate",{method:"POST",body:JSON.stringify({requests:[{addSheet:{properties:{title}}}]})});
      if(!created.ok)throw new PersistenceError("SHEETS_WRITE_UNCONFIRMED");
    }
    const prior=await proxy(base+`/values/${encodeURIComponent(title+"!A:A")}`,{method:"GET"});
    if(!prior.ok)throw new PersistenceError("SHEETS_READ_UNCONFIRMED");
    const seen=new Set(((await prior.json()) as {values?:string[][]}).values?.map(r=>r[0])??[]);
    const rows=(await c.query(`SELECT t.id_ticket::text,t.resumen,t.estado,t.cerrado_en,s.categoria,s.subcategoria,c.centro,c.departamento
      FROM public.tickets t JOIN public.servicios s USING(id_servicio) LEFT JOIN public.colaboradores c USING(id_colaborador)
      WHERE t.cerrado_en IS NOT NULL AND to_char(t.cerrado_en AT TIME ZONE 'America/Mexico_City','YYYY-MM')=$1
      AND s.categoria IN ('Nómina y prestaciones','Políticas y procedimientos') ORDER BY t.id_ticket`,[month])).rows;
    const pending=rows.filter(r=>!seen.has(r.id_ticket));
    if(pending.length){
      const written=await proxy(base+`/values/${encodeURIComponent(title+"!A:H")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{
        method:"POST",body:JSON.stringify({values:pending.map(r=>[r.id_ticket,r.categoria,r.subcategoria,r.centro,r.departamento,r.resumen,r.estado,new Date(r.cerrado_en).toISOString()].map(safeCell))})
      });
      if(!written.ok)throw new PersistenceError("SHEETS_WRITE_UNCONFIRMED");
    }
    // Re-read before marking archived; an uncertain external append never silently archives.
    const verify=await proxy(base+`/values/${encodeURIComponent(title+"!A:A")}`,{method:"GET"});
    if(!verify.ok)throw new PersistenceError("SHEETS_VERIFICATION_REQUIRED");
    const ids=new Set(((await verify.json()) as {values?:string[][]}).values?.map(r=>r[0])??[]);
    const confirmed=rows.filter(r=>ids.has(r.id_ticket)).map(r=>r.id_ticket);
    if(confirmed.length)await c.query("UPDATE public.tickets SET archivado_en=coalesce(archivado_en,clock_timestamp()) WHERE id_ticket=ANY($1::bigint[])",[confirmed]);
    return {archived:confirmed.length,appended:pending.length,deleted:0};
  }catch(e){
    if(e instanceof PersistenceError)throw e;
    throw new PersistenceError("SHEETS_CONNECTION_PENDING");
  }finally{
    if(locked)await c.query("SELECT pg_advisory_unlock(2026111002)").catch(()=>{});
    c.release();
  }
}
