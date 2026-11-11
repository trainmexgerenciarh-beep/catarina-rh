import type pg from "pg";
import {createHash} from "node:crypto";
import {ReplitConnectors} from "@replit/connectors-sdk";
import {PersistenceError} from "./persistence-unit.ts";
type Proxy=(path:string,init:{method:"GET"|"POST";body?:string;signal?:AbortSignal})=>Promise<Response>;
const connectors=new ReplitConnectors();
const request:Proxy=(path,init)=>connectors.proxy("google-sheet",path,{...init,signal:init.signal??AbortSignal.timeout(10000)});
const safeCell=(v:unknown)=>{const s=String(v??"");return /^[=+\-@\t\r]/.test(s)?"'"+s:s;};
const header=["id_ticket","categoria","subcategoria","centro","departamento","resumen","estado","cerrado_en","huella_v1","version"];
const hash=(cells:string[])=>createHash("sha256").update(JSON.stringify(cells)).digest("hex");
const metadataKey="catarina_ticket_v1";
const receiptId=(id:string)=>(createHash("sha256").update(metadataKey+":"+id).digest().readUInt32BE(0)&0x7fffffff)||1;
type Metadata={metadataId:number;metadataKey:string;metadataValue:string};
type Info={sheets:{properties:{title:string;sheetId:number}}[];developerMetadata?:Metadata[]};
function receipts(info:Info){
  const all=new Map<number,Metadata>(),owned=new Map<string,{version:number;ticket:string;month:string;hash:string}>();
  for(const m of info.developerMetadata??[]){
    if(!Number.isInteger(m.metadataId)||all.has(m.metadataId))throw new PersistenceError("SHEETS_TRACE_CONFLICT");
    all.set(m.metadataId,m);if(m.metadataKey!==metadataKey)continue;
    let v;try{v=JSON.parse(m.metadataValue);}catch{throw new PersistenceError("SHEETS_TRACE_CONFLICT");}
    if(v?.version!==1||typeof v.ticket!=="string"||!/^[1-9]\d*$/.test(v.ticket)||
      typeof v.hash!=="string"||!/^[a-f0-9]{64}$/.test(v.hash)||typeof v.month!=="string"||
      owned.has(v.ticket)||receiptId(v.ticket)!==m.metadataId)throw new PersistenceError("SHEETS_TRACE_CONFLICT");
    owned.set(v.ticket,v);
  }return {all,owned};
}
const target=()=>{
  const v=process.env.RH_EXPORT_SPREADSHEET_ID;
  if(!v||!/^[A-Za-z0-9_-]+$/.test(v))throw new PersistenceError("SHEETS_DESTINATION_REQUIRED");
  return `/v4/spreadsheets/${v}`;
};
const checked=async(r:Response,code:string)=>{
  if(!r.ok)throw new PersistenceError([401,403].includes(r.status)?"SHEETS_PERMISSION_REQUIRED":r.status===429?"SHEETS_RATE_LIMIT":code);
  return r;
};
function indexRows(values:unknown):Map<string,string>{
  if(values!==undefined&&!Array.isArray(values))throw new PersistenceError("SHEETS_INVALID_RESPONSE");
  const index=new Map<string,string>();
  for(const raw of values??[]){
    if(!Array.isArray(raw))throw new PersistenceError("SHEETS_INVALID_RESPONSE");
    const row=raw.map(String),id=row[0];if(id==="id_ticket"||!id)continue;
    if(!/^[1-9]\d*$/.test(id)||row.length<8||index.has(id))throw new PersistenceError("SHEETS_TRACE_CONFLICT");
    const computed=hash(row.slice(0,8));
    if(row[8]&&(row[8]!==computed||row[9]!=="1"))throw new PersistenceError("SHEETS_TRACE_CONFLICT");
    index.set(id,computed);
  }return index;
}
export async function inspectExportDestination(proxy:Proxy=request){
  await checked(await proxy(target()+"?fields=spreadsheetId,sheets.properties.title",{method:"GET"}),"SHEETS_READ_UNCONFIRMED");
  return {accessible:true,readOnly:true,writePermission:"NOT_PROVEN_WITHOUT_AUTHORIZED_WRITE"};
}
/** Transaction-scoped lock works with Neon's transaction pooler. Only this
 * monthly administrative export holds a bounded transaction over Google I/O
 * (25s aggregate HTTP budget / 30s idle-in-transaction guard). Never Gemini.
 * Atomic AppendCells + unique deterministic DeveloperMetadata IDs fence late
 * provider commits after timeouts, not just immediate read-before-append replay.
 */
export async function exportMonth(pool:pg.Pool,month:string,options:{proxy?:Proxy}={}){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new PersistenceError("INVALID_MONTH");
  const base=target(),rawProxy=options.proxy??request,title=`Tickets_${month.replace("-","_")}`;
  const budget=AbortSignal.timeout(25000);
  const proxy:Proxy=async(path,init)=>{
    budget.throwIfAborted();
    const signal=AbortSignal.any([budget,AbortSignal.timeout(10000)]);
    return new Promise<Response>((resolve,reject)=>{
      const abort=()=>reject(new Error("SHEETS_TIMEOUT"));
      signal.addEventListener("abort",abort,{once:true});
      rawProxy(path,{...init,signal}).then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
    });
  };
  const c=await pool.connect();let begun=false,commitStarted=false,destroy=false;
  try{
    await c.query("BEGIN");begun=true;
    await c.query("SET LOCAL lock_timeout='5s'");
    await c.query("SET LOCAL statement_timeout='10s'");
    await c.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
    const acquired=await c.query("SELECT pg_try_advisory_xact_lock(2026111002) AS acquired");
    if(acquired.rows[0]?.acquired!==true)throw new PersistenceError("PERSISTENCE_BUSY");
    const readInfo=async()=>{
      const meta=await checked(await proxy(base+"?fields=sheets.properties(title,sheetId),developerMetadata",{method:"GET"}),"SHEETS_READ_UNCONFIRMED");
      const info=await meta.json() as Info;
      if(!Array.isArray(info?.sheets)||info.developerMetadata!==undefined&&!Array.isArray(info.developerMetadata))
        throw new PersistenceError("SHEETS_INVALID_RESPONSE");
      return info;
    };
    let info=await readInfo();
    if(!info.sheets.some(s=>s.properties?.title===title)){
      await checked(await proxy(base+":batchUpdate",{method:"POST",body:JSON.stringify({requests:[{addSheet:{properties:{title}}}]})}),"SHEETS_WRITE_UNCONFIRMED");
      info=await readInfo();
    }
    const sheetId=info.sheets.find(s=>s.properties?.title===title)?.properties.sheetId;
    if(typeof sheetId!=="number"||!Number.isInteger(sheetId)||sheetId<0)throw new PersistenceError("SHEETS_INVALID_RESPONSE");
    const range=base+`/values/${encodeURIComponent(title+"!A:J")}`;
    const read=async()=>{const r=await checked(await proxy(range,{method:"GET"}),"SHEETS_READ_UNCONFIRMED");return (await r.json()) as {values?:unknown};};
    const prior=await read(),seen=indexRows(prior.values);
    const rows=(await c.query(`SELECT t.id_ticket::text,t.resumen,t.estado,t.cerrado_en,s.categoria,s.subcategoria,c.centro,c.departamento
      FROM public.tickets t JOIN public.servicios s USING(id_servicio) LEFT JOIN public.colaboradores c USING(id_colaborador)
      WHERE t.cerrado_en IS NOT NULL AND t.archivado_en IS NULL
        AND to_char(t.cerrado_en AT TIME ZONE 'America/Mexico_City','YYYY-MM')=$1
        AND s.categoria IN ('Nómina y prestaciones','Políticas y procedimientos') ORDER BY t.id_ticket FOR UPDATE OF t`,[month])).rows;
    const cells=rows.map(r=>[r.id_ticket,r.categoria,r.subcategoria,r.centro,r.departamento,r.resumen,r.estado,new Date(r.cerrado_en).toISOString()].map(safeCell));
    for(const row of cells)if(seen.has(row[0])&&seen.get(row[0])!==hash(row))throw new PersistenceError("SHEETS_TRACE_CONFLICT");
    const {all,owned}=receipts(info);
    for(const row of cells){
      const m=owned.get(row[0]);
      if(m&&(!seen.has(row[0])||m.month!==month||m.hash!==hash(row)))throw new PersistenceError("SHEETS_TRACE_CONFLICT");
      if(!m&&all.has(receiptId(row[0])))throw new PersistenceError("SHEETS_IDENTITY_CONFLICT");
    }
    const pending=cells.filter(row=>!seen.has(row[0]));
    const creates=cells.filter(row=>!owned.has(row[0])).map(row=>({createDeveloperMetadata:{developerMetadata:{
      metadataId:receiptId(row[0]),metadataKey,metadataValue:JSON.stringify({version:1,ticket:row[0],month,hash:hash(row)}),
      visibility:"DOCUMENT",location:{spreadsheet:true}}}}));
    if(pending.length||creates.length){
      const values=pending.map(row=>[...row,hash(row),"1"]);
      if(values.length&&(!Array.isArray(prior.values)||!prior.values.length))values.unshift(header);
      const requests:unknown[]=[...creates];
      if(values.length)requests.push({appendCells:{sheetId,fields:"userEnteredValue",
        rows:values.map(row=>({values:row.map(v=>({userEnteredValue:{stringValue:v}}))}))}});
      await checked(await proxy(base+":batchUpdate",{method:"POST",body:JSON.stringify({requests})}),"SHEETS_WRITE_UNCONFIRMED");
    }
    const verified=indexRows((await read()).values);
    const proof=receipts(await readInfo()).owned;
    const confirmed=cells.filter(row=>verified.get(row[0])===hash(row)&&proof.get(row[0])?.hash===hash(row)&&
      proof.get(row[0])?.month===month).map(row=>row[0]);
    if(confirmed.length!==rows.length)throw new PersistenceError("SHEETS_VERIFICATION_REQUIRED");
    budget.throwIfAborted();
    if(confirmed.length)await c.query("UPDATE public.tickets SET archivado_en=coalesce(archivado_en,clock_timestamp()) WHERE id_ticket=ANY($1::bigint[])",[confirmed]);
    commitStarted=true;await c.query("COMMIT");begun=false;
    return {archived:confirmed.length,appended:pending.length,deleted:0};
  }catch(e){
    if(begun)try{await c.query("ROLLBACK");}catch{destroy=true;}
    if(commitStarted){destroy=true;throw new PersistenceError("COMMIT_OUTCOME_UNKNOWN");}
    if(e instanceof PersistenceError)throw e;
    throw new PersistenceError("SHEETS_CONNECTION_PENDING");
  }finally{
    c.release(destroy);
  }
}
