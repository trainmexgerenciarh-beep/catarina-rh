import {ReplitConnectors} from "@replit/connectors-sdk";
import {readDriveText} from "./institutional-sources.ts";
import {contentHash,libraryError} from "./library-contract.ts";
export type DriveRequest=(path:string)=>Promise<Response>;
const connectors=new ReplitConnectors();
export const driveRequest:DriveRequest=path=>connectors.proxy("google-drive",path,{method:"GET",signal:AbortSignal.timeout(20000)});
export type DriveDocument={id:string;name:string;mimeType:string;version?:string;modifiedTime?:string;trashed?:boolean;parents?:string[]};
const folderMime="application/vnd.google-apps.folder";
const types=["application/pdf","application/vnd.google-apps.document"];
export async function driveMetadata(id:string,request:DriveRequest=driveRequest):Promise<DriveDocument>{
  if(!/^[A-Za-z0-9_-]{10,}$/.test(id))return libraryError("LIBRARY_INVALID_ID");
  const r=await request(`/drive/v3/files/${id}?supportsAllDrives=true&fields=id,name,mimeType,version,modifiedTime,trashed,parents`);
  if(!r.ok)return libraryError([401,403,404].includes(r.status)?"LIBRARY_DRIVE_ACCESS":"LIBRARY_DRIVE_UNAVAILABLE");
  const info=await r.json();
  if(info.id!==id||info.trashed||typeof info.name!=="string")return libraryError("LIBRARY_DRIVE_ACCESS");
  return info;
}
export async function readLibraryDocument(id:string,request:DriveRequest=driveRequest){
  const meta=await driveMetadata(id,request);
  if(!types.includes(meta.mimeType))return libraryError("LIBRARY_UNSUPPORTED_TYPE");
  const content=await readDriveText(id,request);
  const after=await driveMetadata(id,request);
  if(meta.version!==after.version||meta.modifiedTime!==after.modifiedTime)return libraryError("LIBRARY_CHANGED_DURING_READ");
  return {meta:after,content,hash:contentHash(content)};
}
/** Full pagination; partial listings are NEVER treated as proof of deletion. */
export async function listLibraryTree(rootId:string,request:DriveRequest=driveRequest){
  const root=await driveMetadata(rootId,request);
  if(root.mimeType!==folderMime)return libraryError("LIBRARY_INVALID_FOLDER");
  const files:{file:DriveDocument;folder:string}[]=[],visited=new Set<string>(),queue=[{id:rootId,path:root.name,depth:0}];
  let pages=0;
  while(queue.length){
    const item=queue.shift()!;if(visited.has(item.id))continue;visited.add(item.id);
    if(item.depth>10||visited.size>100)return libraryError("LIBRARY_TREE_TOO_LARGE");
    let token:string|undefined;
    do{
      if(++pages>30)return libraryError("LIBRARY_TREE_TOO_LARGE");
      const query=new URLSearchParams({q:`'${item.id}' in parents and trashed=false`,pageSize:"100",
        fields:"nextPageToken,incompleteSearch,files(id,name,mimeType,version,modifiedTime,parents)",
        supportsAllDrives:"true",includeItemsFromAllDrives:"true"});
      if(token)query.set("pageToken",token);
      const r=await request("/drive/v3/files?"+query);
      if(!r.ok)return libraryError([401,403,404].includes(r.status)?"LIBRARY_DRIVE_ACCESS":"LIBRARY_DRIVE_UNAVAILABLE");
      const body=await r.json();
      if(!Array.isArray(body.files)||body.incompleteSearch)return libraryError("LIBRARY_LIST_INCOMPLETE");
      for(const file of body.files){
        if(typeof file.id!=="string"||!/^[A-Za-z0-9_-]{10,}$/.test(file.id)||typeof file.name!=="string")return libraryError("LIBRARY_LIST_INCOMPLETE");
        if(file.mimeType===folderMime)queue.push({id:file.id,path:item.path+"/"+file.name,depth:item.depth+1});
        else if(types.includes(file.mimeType)){files.push({file,folder:item.path});if(files.length>500)return libraryError("LIBRARY_TREE_TOO_LARGE");}
      }
      const next=body.nextPageToken;
      if(next!==undefined&&typeof next!=="string")return libraryError("LIBRARY_LIST_INCOMPLETE");
      if(next===token&&next)return libraryError("LIBRARY_LIST_INCOMPLETE");
      token=next;
    }while(token);
  }
  return {root,files};
}
