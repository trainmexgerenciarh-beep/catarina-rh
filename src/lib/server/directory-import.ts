import type pg from "pg";
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {ReplitConnectors} from "@replit/connectors-sdk";
import type {Admin} from "./admin-auth.ts";
import {isOwner} from "./admin-users.ts";
import {PersistenceError,AGENDA_LOCK_KEY} from "./persistence-unit.ts";
import {DIRECTORY_SHEET_ID,DIRECTORY_RANGE} from "./sheets-config.ts";

type Cell=string|number|boolean|null;
export type DirectoryRow={id_colaborador:string;nombre:string;whatsapp:string;centro:string|null;departamento:string;puesto:string;activo:boolean};
type Existing=DirectoryRow;
type PreviewRow=Partial<DirectoryRow>&{line:number;originalPhone?:string;originalStatus?:string;action:"ALTA"|"SIN_CAMBIOS"|"CAMBIO_BLOQUEADO"|"RECHAZO";reason:string;changes?:string[]};
type Proxy=(path:string,init:{method:"GET";signal?:AbortSignal})=>Promise<Response>;
const connectors=new ReplitConnectors();
const request:Proxy=(path,init)=>connectors.proxy("google-sheet",path,{...init,signal:AbortSignal.timeout(10000)});
export const IMPORT_MAX_BYTES=204800;
const MAX_ROWS=200;
const normalize=(s:unknown)=>String(s??"").trim().normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/\s+/g," ");
const keys=["numero de empleado","nombre completo","departamento","whatsapp","puesto","estatus"];
const fields=(r:DirectoryRow)=>[r.id_colaborador,r.nombre,r.whatsapp,r.centro,r.departamento,r.puesto,r.activo];
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const fail=(code:string):never=>{throw new PersistenceError(code);};

/** RFC4180-compatible quoting, CRLF and quoted newlines. TSV from Sheets supported. */
export function parseDirectoryText(text:unknown):string[][]{
  if(typeof text!=="string"||Buffer.byteLength(text)>IMPORT_MAX_BYTES)fail("IMPORT_INVALID_INPUT");
  const s=(text as string).replace(/^\uFEFF/,"");
  const first=s.split(/\r?\n/,1)[0],delimiter=first.includes("\t")?"\t":first.includes(";")?";":",";
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false,closed=false;
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(quoted){if(ch==='"'){if(s[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
    if(ch==='"'){if(cell||closed)fail("IMPORT_INVALID_INPUT");quoted=true;continue;}
    if(ch===delimiter||ch==="\n"||ch==="\r"){
      row.push(cell);cell="";closed=false;
      if(ch!==delimiter){rows.push(row);row=[];if(ch==="\r"&&s[i+1]==="\n")i++;}
    }else{if(closed)fail("IMPORT_INVALID_INPUT");cell+=ch;}
  }
  if(quoted)fail("IMPORT_INVALID_INPUT");
  if(cell||row.length||closed){row.push(cell);rows.push(row);}
  return rows;
}
/** No inferred foreign country codes. Ten local digits explicitly mean Mexico.
 * Legacy 521 is NOT silently converted; admin must verify/correct it. */
export function normalizeDirectoryPhone(raw:unknown):string{
  const s=String(raw??"").trim();
  if(!/^\+?[\d ()-]+$/.test(s))return fail("IMPORT_PHONE_INVALID");
  let v=s.replace(/\D/g,"");
  if(v.length===10&&!s.startsWith("+"))v="52"+v;
  if(!/^[1-9]\d{7,14}$/.test(v)||/^521\d{10}$/.test(v)||
    (!s.startsWith("+")&&!(v.length===12&&v.startsWith("52"))))return fail("IMPORT_PHONE_INVALID");
  return v;
}
function status(raw:unknown){
  const s=normalize(raw);
  if(["activo","active","true","1","si"].includes(s))return true;
  if(["inactivo","inactive","false","0","no"].includes(s))return false;
  return fail("IMPORT_STATUS_INVALID");
}
const bounded=(v:unknown,max:number,required=true)=>{
  const s=String(v??"").trim();
  if(s.length>max||(required&&!s)||/[\u0000-\u001f\u007f]/.test(s))fail("IMPORT_INVALID_INPUT");
  return s;
};
export function previewDirectory(matrix:Cell[][],existing:Existing[]){
  if(!Array.isArray(matrix)||!matrix.length||matrix.some(r=>!Array.isArray(r))||
    Buffer.byteLength(JSON.stringify(matrix))>IMPORT_MAX_BYTES)fail("IMPORT_INVALID_INPUT");
  const headers=matrix[0].map(c=>{const h=normalize(c);return h==="centro de trabajo"?"centro":h;});
  if(keys.some(k=>headers.filter(h=>h===k).length!==1)||headers.some(h=>h&&!keys.includes(h)&&h!=="centro")||
    headers.filter(h=>h==="centro").length>1)fail("IMPORT_HEADERS_INVALID");
  const data=matrix.slice(1).filter(r=>r.some(c=>String(c??"").trim()));
  if(data.length>MAX_ROWS)fail("IMPORT_TOO_MANY_ROWS");
  const rows:PreviewRow[]=matrix.slice(1).flatMap((row,index)=>{
    if(!row.some(c=>String(c??"").trim()))return [];
    const out:PreviewRow={line:index+2,action:"RECHAZO",reason:""};
    try{
      if(row.length>headers.length&&row.slice(headers.length).some(c=>String(c??"").trim()))fail("IMPORT_HEADERS_INVALID");
      const value=(h:string)=>row[headers.indexOf(h)]??"";
      out.originalPhone=bounded(value("whatsapp"),40);out.originalStatus=bounded(value("estatus"),30);
      const id=bounded(value(keys[0]),80);
      if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id))fail("IMPORT_IDENTIFIER_INVALID");
      Object.assign(out,{id_colaborador:id,nombre:bounded(value(keys[1]),150),
        whatsapp:normalizeDirectoryPhone(value("whatsapp")),activo:status(value("estatus")),
        centro:bounded(value("centro"),150,false)||null,departamento:bounded(value("departamento"),150),puesto:bounded(value("puesto"),150)});
      out.action="ALTA";out.reason="Registro nuevo; requiere confirmación.";
    }catch(e){out.reason=e instanceof PersistenceError?e.code:"IMPORT_INVALID_INPUT";}
    return [out];
  });
  const countsBy=(key:"id_colaborador"|"whatsapp")=>{
    const m=new Map<string,number>();for(const r of rows)if(r[key])m.set(r[key]!,1+(m.get(r[key]!)??0));return m;
  };
  const ids=countsBy("id_colaborador"),phones=countsBy("whatsapp");
  for(const r of rows){
    if(r.action!=="ALTA")continue;
    if((ids.get(r.id_colaborador!)??0)>1||(phones.get(r.whatsapp!)??0)>1){r.action="RECHAZO";r.reason="Identificador o teléfono repetido dentro del archivo.";continue;}
    const same=existing.find(e=>e.id_colaborador===r.id_colaborador);
    const other=existing.find(e=>e.id_colaborador!==r.id_colaborador&&e.whatsapp?.replace(/\D/g,"")===r.whatsapp);
    if(other){r.action="RECHAZO";r.reason="El teléfono ya está registrado; no se modifica ningún colaborador.";continue;}
    if(same){
      r.changes=(["nombre","whatsapp","centro","departamento","puesto","activo"] as const).filter(k=>
        (same[k]??null)!==(r[k]??null));
      r.action=r.changes.length?"CAMBIO_BLOQUEADO":"SIN_CAMBIOS";
      r.reason=r.changes.length?"Diferencias detectadas. El importador NO sobrescribe registros existentes.":"Registro idéntico; no se vuelve a insertar.";
    }
  }
  return {rows,counts:{altas:rows.filter(r=>r.action==="ALTA").length,
    sinCambios:rows.filter(r=>r.action==="SIN_CAMBIOS").length,cambios:rows.filter(r=>r.action==="CAMBIO_BLOQUEADO").length,
    rechazos:rows.filter(r=>r.action==="RECHAZO").length}};
}
export async function readDirectorySheet(proxy:Proxy=request):Promise<Cell[][]>{
  const r=await proxy(`/v4/spreadsheets/${DIRECTORY_SHEET_ID}/values/${encodeURIComponent(DIRECTORY_RANGE)}?valueRenderOption=FORMATTED_VALUE`,{method:"GET"});
  if(!r.ok)fail([401,403,404].includes(r.status)?"IMPORT_SHEET_PERMISSION":"IMPORT_SHEET_UNAVAILABLE");
  const reader=r.body?.getReader();if(!reader)fail("IMPORT_INVALID_INPUT");
  const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const part=await reader!.read();if(part.done)break;size+=part.value.byteLength;
      if(size>IMPORT_MAX_BYTES){await reader!.cancel();fail("IMPORT_INVALID_INPUT");}chunks.push(part.value);}
  }finally{reader!.releaseLock();}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{fail("IMPORT_INVALID_INPUT");}
  if(!Array.isArray(body.values))fail("IMPORT_INVALID_INPUT");
  return body.values;
}
const readExisting=async(c:Pick<pg.Pool,"query">)=>(
  await c.query("SELECT id_colaborador,nombre,whatsapp,centro,departamento,puesto,activo FROM public.colaboradores ORDER BY id_colaborador")
).rows as Existing[];
function secret(){const s=process.env.SESSION_SECRET;if(!s||s.length<32)fail("IMPORT_CONFIGURATION_REQUIRED");return s!;}
function stamp(matrix:Cell[][],existing:Existing[]){return digest([matrix,existing.map(fields)]);}
function signature(payload:string){return createHmac("sha256",secret()).update(payload).digest("base64url");}
function verify(token:unknown,actor:Admin,source:string,expected:string,now:number){
  if(typeof token!=="string"||token.length>2048)fail("IMPORT_CONFIRMATION_REQUIRED");
  const parts=(token as string).split(".");
  if(parts.length!==2)fail("IMPORT_CONFIRMATION_REQUIRED");
  const want=Buffer.from(signature(parts[0])),got=Buffer.from(parts[1]);
  if(want.length!==got.length||!timingSafeEqual(want,got))fail("IMPORT_CONFIRMATION_REQUIRED");
  let v;try{v=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));}catch{fail("IMPORT_CONFIRMATION_REQUIRED");}
  if(v.v!==1||v.actor!==actor.email||v.source!==source||v.digest!==expected||!Number.isFinite(v.exp)||now>=v.exp)fail("IMPORT_PREVIEW_EXPIRED");
}
/** No application-memory drafts. Token binds exact source + current DB projection
 * to the authenticated principal for 10 minutes. Revalidate after acquiring lock. */
export async function handleDirectoryImport(pool:pg.Pool,actor:Admin,body:Record<string,unknown>,options:{sheet?:()=>Promise<Cell[][]>;now?:()=>number}={}){
  if(!isOwner(actor))fail("ACCESS_DENIED");
  if(!["sheet","local"].includes(String(body.source))||!["preview","confirm"].includes(String(body.action)))fail("IMPORT_INVALID_INPUT");
  const source=String(body.source);
  const matrix=source==="sheet"?await(options.sheet??readDirectorySheet)():parseDirectoryText(body.text);
  const now=options.now??Date.now;
  if(body.action==="preview"){
    const existing=await readExisting(pool),preview=previewDirectory(matrix,existing);
    const payload=Buffer.from(JSON.stringify({v:1,actor:actor.email,source,digest:stamp(matrix,existing),exp:now()+600000})).toString("base64url");
    return {preview,token:payload+"."+signature(payload)};
  }
  // Verify authorization to proceed before acquiring any DB write lock.
  verify(body.token,actor,source,stamp(matrix,await readExisting(pool)),now());
  const c=await pool.connect();let begun=false,commitStarted=false,destroy=false;
  try{
    await c.query("BEGIN");begun=true;
    await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='10s'");
    // Same writer protocol as manual directory administration. Otherwise a
    // manual writer could check a phone before our lock and insert it afterward.
    await c.query("SELECT pg_advisory_xact_lock($1::bigint)",[AGENDA_LOCK_KEY]);
    const active=await c.query("SELECT 1 FROM public.usuarios_rh WHERE email=$1 AND role='gerente' AND activo FOR SHARE",[actor.email]);
    if(active.rowCount!==1)fail("ACCESS_DENIED");
    // Covers concurrent manual directory writes too, not only this importer.
    await c.query("LOCK TABLE public.colaboradores IN SHARE ROW EXCLUSIVE MODE");
    const existing=await readExisting(c as unknown as pg.Pool);
    verify(body.token,actor,source,stamp(matrix,existing),now());
    const preview=previewDirectory(matrix,existing),rows=preview.rows.filter(r=>r.action==="ALTA");
    if(!rows.length)fail("IMPORT_NOTHING_TO_INSERT");
    for(const r of rows)await c.query(`INSERT INTO public.colaboradores(id_colaborador,nombre,whatsapp,centro,departamento,puesto,activo)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,fields(r as DirectoryRow));
    // No PII copied into audit trail, only aggregate count + actor.
    await c.query("INSERT INTO public.auditoria_accesos(actor,accion,cuenta) VALUES($1,'directorio_importacion',$2)",[actor.email,`altas:${rows.length}`]);
    commitStarted=true;await c.query("COMMIT");begun=false;
    return {inserted:rows.length,updated:0,rejected:preview.counts.rechazos,blocked:preview.counts.cambios};
  }catch(e){
    if(begun)try{await c.query("ROLLBACK");}catch{destroy=true;}
    if(commitStarted){destroy=true;fail("COMMIT_OUTCOME_UNKNOWN");}
    if(e instanceof PersistenceError)throw e;
    fail("IMPORT_NOT_CONFIRMED");
  }finally{c.release(destroy);}
}
