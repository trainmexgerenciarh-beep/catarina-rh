import type pg from "pg";
import {DIRECTORY_SHEET_ID,EXPORT_SHEET_ID} from "./sheets-config.ts";
import {libraryError} from "./library-contract.ts";
export function parseSheetId(v:unknown){
  const s=String(v??"").trim();if(/^[A-Za-z0-9_-]{10,}$/.test(s))return s;
  let u;try{u=new URL(s);}catch{return libraryError("LIBRARY_RESOURCE_INVALID");}
  const id=u.pathname.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  if(u.protocol!=="https:"||u.hostname!=="docs.google.com"||!id)return libraryError("LIBRARY_RESOURCE_INVALID");return id;
}
export async function getProjectResources(pool:Pick<pg.Pool,"query">){
  const rows=(await pool.query("SELECT biblioteca FROM fuentes WHERE biblioteca->>'kind'='resources' ORDER BY id_fuente")).rows;
  if(rows.length>1)libraryError("LIBRARY_RESOURCE_CONFLICT");
  const b=rows[0]?.biblioteca;
  return {directoryId:b?parseSheetId(b.directoryId):DIRECTORY_SHEET_ID,exportId:b?parseSheetId(b.exportId):EXPORT_SHEET_ID};
}
