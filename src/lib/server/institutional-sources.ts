import { ReplitConnectors } from "@replit/connectors-sdk";
import {localDate} from "./agenda-time.ts";
import {contentHash,validateFragments,type LibraryMeta} from "./library-contract.ts";
export type Source = {id_fuente:string;nombre:string;categoria:string;url_drive:string;version:string;vigente_desde:string;biblioteca?:LibraryMeta};
const connectors=new ReplitConnectors();
export function driveId(url:string):string {
  const u=new URL(url);
  if(!["docs.google.com","drive.google.com"].includes(u.hostname)||u.protocol!=="https:")throw new Error("INVALID_DRIVE_SOURCE");
  const id=u.pathname.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1]??u.searchParams.get("id");
  if(!id||!/^[A-Za-z0-9_-]{10,}$/.test(id))throw new Error("INVALID_DRIVE_SOURCE");
  return id;
}
export async function readSource(source:Source):Promise<string> {
  const id=driveId(source.url_drive);
  return readDriveText(id,async path=>connectors.proxy("google-drive",path,{method:"GET",signal:AbortSignal.timeout(20_000)}));
}
/** Revalidate live permission/content; never feed the whole internal procedure
 * to the worker answer path. Old active=true alone is not publication consent. */
export function authorizedFragments(source:Source,content:string):string[]|null{
  const b=source.biblioteca,a=b?.approval,today=localDate(Date.now());
  if(b?.kind!=="document"||b.status!=="APROBADO"||!a||b.error||!a.actor||!a.at||!a.scope||
    a.hash!==b.hash||a.hash!==contentHash(content)||source.version!==a.version||
    source.vigente_desde?.slice(0,10)!==a.validFrom||a.validFrom>today||a.validUntil&&a.validUntil<today||
    !Array.isArray(a.fragments)||!a.fragments.length||a.fragments.some(f=>!content.replace(/\r\n?/g,"\n").includes(f)))return null;
  try{
    if(driveId(source.url_drive)!==b.driveId)return null;
    validateFragments(content,a.fragments,b.type??"PROCEDIMIENTO_INTERNO");
  }catch{return null;}
  return a.fragments;
}
/** Only approved Drive hosts and Docs/text-PDF types, bounded bytes; no arbitrary URL fetch. */
export async function readDriveText(id:string,request:(path:string)=>Promise<Response>):Promise<string>{
  if(!/^[A-Za-z0-9_-]{10,}$/.test(id))throw new Error("INVALID_DRIVE_SOURCE");
  const meta=await request(`/drive/v3/files/${id}?fields=mimeType,size`);
  if(!meta.ok)throw new Error("DRIVE_SOURCE_UNAVAILABLE");
  const info=await meta.json();
  if(!["application/pdf","application/vnd.google-apps.document"].includes(info.mimeType))throw new Error("DRIVE_SOURCE_TYPE_UNSUPPORTED");
  if(Number(info.size)>10_000_000)throw new Error("SOURCE_TOO_LARGE");
  const pdf=info.mimeType==="application/pdf";
  const r=await request(pdf?`/drive/v3/files/${id}?alt=media`:`/drive/v3/files/${id}/export?mimeType=text%2Fplain`);
  if(!r.ok)throw new Error("DRIVE_SOURCE_UNAVAILABLE");
  if(Number(r.headers.get("content-length"))>10_000_000)throw new Error("SOURCE_TOO_LARGE");
  const reader=r.body?.getReader();if(!reader)throw new Error("SOURCE_CONTENT_UNAVAILABLE");
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;
    if(size>10_000_000)throw new Error("SOURCE_TOO_LARGE");chunks.push(value);}}
  finally{await reader.cancel();}
  const bytes=Buffer.concat(chunks);
  let text:string;
  if(pdf){
    const {extractText}=await import("unpdf");
    text=(await extractText(new Uint8Array(bytes),{mergePages:true})).text;
  }else text=bytes.toString("utf8");
  if(!text.trim()||text.length>500000)throw new Error("SOURCE_CONTENT_UNAVAILABLE");
  return text;
}
const normalize=(t:string)=>t.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
/** Exact source extracts, not generated policy. Insufficient evidence routes to RH. */
export async function groundedAnswer(question:string,service:string,sources:Source[],reader=readSource) {
  const words=[...new Set(normalize(question+" "+service).match(/[a-z]{5,}/g)??[])].filter(w=>!["quiero","necesito","sobre","puedo","cuales","tengo","para","saber"].includes(w));
  const candidates:{source:Source;excerpt:string;score:number}[]=[];
  for(const source of sources) {
    if(!source.version||!source.vigente_desde||source.vigente_desde.slice(0,10)>localDate(Date.now()))continue;
    try{
      const content=await reader(source),fragments=authorizedFragments(source,content);
      if(!fragments)continue;
      for(const p of fragments.filter(x=>x.length>=20&&x.length<=2500)) {
        const n=normalize(p),score=words.filter(w=>n.includes(w)).length;
        if(score>=Math.min(3,Math.max(2,words.length)))candidates.push({source,excerpt:p,score});
      }
    }catch{/* Explicitly missing evidence, never invented policy or a fabricated connector success. */}
  }
  candidates.sort((a,b)=>b.score-a.score);
  // Multiple different qualifying extracts can conflict or require contextual
  // interpretation. Do not guess precedence; route to RH instead.
  if(new Set(candidates.map(c=>normalize(c.excerpt).trim())).size>1)return null;
  const best=candidates[0];
  return best?{text:`La fuente institucional indica:\n«${best.excerpt}»\nFuente: ${best.source.nombre}, versión ${best.source.version}, vigente desde ${best.source.vigente_desde.slice(0,10)}.\nSi este extracto no responde tu caso, indica «necesito atención de RH».`,sourceId:best.source.id_fuente,
    proof:contentHash(JSON.stringify(best.source.biblioteca))}:null;
}
