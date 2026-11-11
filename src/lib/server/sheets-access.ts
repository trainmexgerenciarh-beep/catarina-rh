import {ReplitConnectors} from "@replit/connectors-sdk";
import {EXPORT_SHEET_ID} from "./sheets-config.ts";
import {PersistenceError} from "./persistence-unit.ts";
type Init={method:"GET"|"POST";body?:string};
export type GoogleProxy=(connector:"google-sheet"|"google-drive",path:string,init:Init)=>Promise<Response>;
const connectors=new ReplitConnectors();
const proxy:GoogleProxy=(connector,path,init)=>connectors.proxy(connector,path,{...init,signal:AbortSignal.timeout(10000)});
const base=`/v4/spreadsheets/${EXPORT_SHEET_ID}`;
const range=encodeURIComponent("'Hoja 1'");
const check=async(r:Response)=>{
  if(!r.ok)throw new PersistenceError([401,403,404].includes(r.status)?"SHEETS_PERMISSION_REQUIRED":"SHEETS_CONNECTION_PENDING");
  return r.json();
};
/** Drive and Sheets are two OAuth connections; never infer one identity from the
 * other. canEdit is evidence for Drive only; Sheets writing needs its own proof. */
export async function inspectSheetsAccess(call:GoogleProxy=proxy){
  const sheet=await check(await call("google-sheet",base+"?fields=sheets.properties(sheetId,title)",{method:"GET"}));
  let driveIdentity:string|null=null,driveCanEdit:boolean|null=null;
  try{
    const about=await check(await call("google-drive","/drive/v3/about?fields=user(emailAddress)",{method:"GET"}));
    driveIdentity=typeof about.user?.emailAddress==="string"?about.user.emailAddress:null;
    const meta=await check(await call("google-drive",`/drive/v3/files/${EXPORT_SHEET_ID}?fields=capabilities(canEdit)`,{method:"GET"}));
    driveCanEdit=typeof meta.capabilities?.canEdit==="boolean"?meta.capabilities.canEdit:null;
  }catch{/* Independent Drive failure does not prove a Sheets permission failure. */}
  return {accessible:true,readOnly:true,driveIdentity,driveCanEdit,
    sheetsIdentity:"NOT_EXPOSED_BY_CONNECTOR",writePermission:"NOT_PROVEN_WITHOUT_AUTHORIZED_WRITE",
    expectedTab:sheet.sheets?.some((s:{properties?:{title?:string;sheetId?:number}})=>s.properties?.title==="Hoja 1"&&s.properties.sheetId===0)===true};
}
/** Explicit operator-only authorized canary. NEVER called by a normal UI request.
 * Writes ONE synthetic row to the confirmed empty tab; clears only its exact
 * three cells after rereading marker, then verifies empty again. No ticket SQL. */
export async function runAuthorizedCanary(marker:string,call:GoogleProxy=proxy){
  if(!/^PRUEBA CATARINA [a-f0-9]{32}$/.test(marker))throw new PersistenceError("CANARY_MARKER_INVALID");
  const access=await inspectSheetsAccess(call);
  if(!access.expectedTab||access.driveCanEdit!==true)throw new PersistenceError("CANARY_PREFLIGHT_BLOCKED");
  const read=async()=>await check(await call("google-sheet",base+`/values/${range}`,{method:"GET"}));
  const empty=(v:unknown)=>v===undefined||Array.isArray(v)&&v.every((r:unknown)=>Array.isArray(r)&&r.every(c=>c===""||c===null));
  const before=await read();
  if(!empty(before.values))throw new PersistenceError("CANARY_DESTINATION_NOT_EMPTY");
  const row=[marker,"FICTICIO SIN DATOS PERSONALES","canary-v1"];
  const own=(v:unknown)=>JSON.stringify(v)===JSON.stringify([row]);
  let attempted=false,verified=false,cleaned=false;
  try{
    // Recheck immediately; no lock is available across Google clients.
    if(!empty((await read()).values))throw new PersistenceError("CANARY_DESTINATION_NOT_EMPTY");
    attempted=true;
    await check(await call("google-sheet",base+":batchUpdate",{method:"POST",body:JSON.stringify({requests:[{
      updateCells:{start:{sheetId:0,rowIndex:0,columnIndex:0},
        rows:[{values:row.map(v=>({userEnteredValue:{stringValue:v}}))}],fields:"userEnteredValue"}
    }]})}));
    verified=own((await read()).values);
    if(!verified)throw new PersistenceError("CANARY_READBACK_FAILED");
  }finally{
    if(attempted){
      // If ack lost, inspect before clearing. Never clear foreign or changed data.
      const current=(await read()).values;
      if(own(current)){
        await check(await call("google-sheet",base+":batchUpdate",{method:"POST",body:JSON.stringify({requests:[{
          updateCells:{range:{sheetId:0,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:3},
            rows:[],fields:"userEnteredValue"}
        }]})}));
        cleaned=empty((await read()).values);
      }else cleaned=empty(current);
      if(!cleaned)throw new PersistenceError("CANARY_CLEANUP_REQUIRES_REVIEW");
    }
  }
  return {writeVerified:verified,readBackVerified:verified,cleaned,emptyBefore:true,emptyAfter:cleaned,
    cellsWritten:3,rowsWritten:1,driveIdentity:access.driveIdentity,sheetsIdentity:access.sheetsIdentity};
}
