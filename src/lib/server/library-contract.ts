import {createHash} from "node:crypto";
import {PersistenceError} from "./persistence-unit.ts";
export type LibraryApproval={actor:string;at:string;hash:string;version?:string;fragments:string[];scope?:string;validFrom?:string;validUntil?:string};
export type LibraryMeta={
  v:1;kind:"document"|"root"|"resources";driveId:string;
  status?:"BORRADOR"|"PENDIENTE_REVISION"|"APROBADO"|"INACTIVO";
  type?:"PROCEDIMIENTO_INTERNO"|"POLITICA/PREGUNTAS_TRABAJADOR";
  hash?:string;revision?:string;lastRead?:string;rootId?:string;folder?:string;mimeType?:string;
  issuedOn?:string;expiresOn?:string;approval?:LibraryApproval;proposal?:Record<string,unknown>;
  enabled?:boolean;lastSync?:string;error?:string;reason?:string;revisionLocal?:number;
};
export const LIBRARY_LOCK="2026111105";
export const normalizeContent=(s:string)=>s.replace(/\r\n?/g,"\n").trim();
export const contentHash=(s:string)=>createHash("sha256").update(normalizeContent(s)).digest("hex");
export const libraryError=(code:string):never=>{throw new PersistenceError(code);};
export function folderId(value:unknown){
  const s=String(value??"").trim();
  if(/^[A-Za-z0-9_-]{10,}$/.test(s))return s;
  let u;try{u=new URL(s);}catch{return libraryError("LIBRARY_INVALID_FOLDER");}
  const id=u.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1];
  if(u.protocol!=="https:"||u.hostname!=="drive.google.com"||!id)return libraryError("LIBRARY_INVALID_FOLDER");
  return id;
}
export function validateFragments(content:string,value:unknown,type:string):string[]{
  const text=normalizeContent(content);
  if(!Array.isArray(value)||value.length<1||value.length>20)return libraryError("LIBRARY_EXCERPTS_REQUIRED");
  const fragments=value.map(v=>normalizeContent(String(v)));
  if(new Set(fragments).size!==fragments.length||fragments.some(v=>v.length<20||v.length>2500)||
    fragments.reduce((n,s)=>n+s.length,0)>50000)return libraryError("LIBRARY_EXCERPTS_REQUIRED");
  const covered=new Uint8Array(text.length);
  for(const fragment of fragments){
    const at=text.indexOf(fragment);if(at<0)return libraryError("LIBRARY_EXCERPT_NOT_EXACT");
    covered.fill(1,at,at+fragment.length);
  }
  if(type==="PROCEDIMIENTO_INTERNO"&&!Array.from(text).some((ch,i)=>!/\s/.test(ch)&&covered[i]===0))
    return libraryError("LIBRARY_INTERNAL_FULL_TEXT_FORBIDDEN");
  return fragments;
}
/** A principal's one-click approval publishes the complete policy as bounded
 * exact chunks. Internal procedures remain excluded from worker answers. */
export function splitApprovedDocument(content:string):string[]{
  const text=normalizeContent(content);
  if(!text||text.length>50000)return libraryError("LIBRARY_DOCUMENT_TOO_LARGE");
  const chunks:string[]=[];
  let start=0;
  while(start<text.length){
    let end=Math.min(start+2500,text.length);
    if(end<text.length){
      for(let i=end-1;i>=start+1200;i--){
        if(/\s/u.test(text[i])){end=i+1;break;}
      }
      if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff&&
        text.charCodeAt(end)>=0xdc00&&text.charCodeAt(end)<=0xdfff)end--;
      let tail=text.slice(end).trim();
      while(tail.length>0&&tail.length<20&&end>start+20){
        end--;
        if(text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff&&
          text.charCodeAt(end)>=0xdc00&&text.charCodeAt(end)<=0xdfff)end--;
        tail=text.slice(end).trim();
      }
    }
    const fragment=text.slice(start,end).trim();
    if(fragment)chunks.push(fragment);
    start=end;
    while(start<text.length&&/\s/u.test(text[start]))start++;
  }
  const unique=[...new Set(chunks)];
  if(unique.length>20||unique.some(s=>s.length<20||s.length>2500)||unique.reduce((n,s)=>n+s.length,0)>50000)
    return libraryError("LIBRARY_DOCUMENT_TOO_LARGE");
  if(unique.some(s=>!text.includes(s)))return libraryError("LIBRARY_EXCERPT_NOT_EXACT");
  return unique;
}
/** Defense-in-depth validation for the exact excerpts stored at approval time.
 * The full source is intentionally not persisted or fetched by each conversation. */
export function validatePublishedFragments(value:unknown):string[]{
  if(!Array.isArray(value)||value.length<1||value.length>20||value.some(v=>typeof v!=="string"))
    return libraryError("LIBRARY_EXCERPTS_REQUIRED");
  const fragments=value.map(v=>normalizeContent(v as string));
  if(new Set(fragments).size!==fragments.length||fragments.some(v=>v.length<20||v.length>2500)||
    fragments.reduce((n,s)=>n+s.length,0)>50000)return libraryError("LIBRARY_EXCERPTS_REQUIRED");
  return fragments;
}
export function dateField(value:unknown,optional=false){
  const s=String(value??"").trim();
  if(!s&&optional)return undefined;
  const parsed=new Date(s+"T12:00:00Z");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==s)return libraryError("LIBRARY_INVALID_DATE");
  return s;
}
