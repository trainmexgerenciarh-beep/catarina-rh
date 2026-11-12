import {createHash} from "node:crypto";
import {PersistenceError} from "./persistence-unit.ts";
export type LibraryApproval={actor:string;at:string;hash:string;version:string;scope:string;fragments:string[];validFrom:string;validUntil?:string};
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
    fragments.reduce((n,s)=>n+s.length,0)>12000)return libraryError("LIBRARY_EXCERPTS_REQUIRED");
  const covered=new Uint8Array(text.length);
  for(const fragment of fragments){
    const at=text.indexOf(fragment);if(at<0)return libraryError("LIBRARY_EXCERPT_NOT_EXACT");
    covered.fill(1,at,at+fragment.length);
  }
  if(type==="PROCEDIMIENTO_INTERNO"&&!Array.from(text).some((ch,i)=>!/\s/.test(ch)&&covered[i]===0))
    return libraryError("LIBRARY_INTERNAL_FULL_TEXT_FORBIDDEN");
  return fragments;
}
/** Defense-in-depth validation for the exact excerpts stored at approval time.
 * The full source is intentionally not persisted or fetched by each conversation. */
export function validatePublishedFragments(value:unknown):string[]{
  if(!Array.isArray(value)||value.length<1||value.length>20||value.some(v=>typeof v!=="string"))
    return libraryError("LIBRARY_EXCERPTS_REQUIRED");
  const fragments=value.map(v=>normalizeContent(v as string));
  if(new Set(fragments).size!==fragments.length||fragments.some(v=>v.length<20||v.length>2500)||
    fragments.reduce((n,s)=>n+s.length,0)>12000)return libraryError("LIBRARY_EXCERPTS_REQUIRED");
  return fragments;
}
export function dateField(value:unknown,optional=false){
  const s=String(value??"").trim();
  if(!s&&optional)return undefined;
  const parsed=new Date(s+"T12:00:00Z");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==s)return libraryError("LIBRARY_INVALID_DATE");
  return s;
}
