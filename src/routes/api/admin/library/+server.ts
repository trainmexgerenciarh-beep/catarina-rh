import type {RequestHandler} from "@sveltejs/kit";
import {readAccessSession} from "../../../../lib/server/admin-access-auth";
import {sameOrigin} from "../../../../lib/server/admin-auth";
import {getNeonPool} from "../../../../lib/server/neon-collaborators";
import {libraryView,libraryAction} from "../../../../lib/server/document-library";
import {readJsonObject} from "../../../../lib/server/request-json";
import {PersistenceError} from "../../../../lib/server/persistence-unit";
import {isOwner} from "../../../../lib/server/admin-users";
const headers={"cache-control":"no-store"};
const messages:Record<string,string>={
  ACCESS_DENIED:"Solo el administrador principal gestiona carpetas, recursos y aprobaciones.",
  LIBRARY_DRIVE_ACCESS:"La identidad conectada no puede leer o listar este recurso. Revisa su permiso de lectura; puedes proponer un enlace individual.",
  LIBRARY_DRIVE_UNAVAILABLE:"Drive no está disponible. No se confirmó lectura ni sincronización.",
  LIBRARY_LIST_INCOMPLETE:"Drive no devolvió un inventario completo. No se interpretó como eliminación.",
  LIBRARY_TREE_TOO_LARGE:"La carpeta supera el límite técnico de esta sincronización. Usa raíces más acotadas.",
  LIBRARY_STALE_REVIEW:"Cambió el documento o su configuración durante la revisión. Vuelve a leerlo.",
  LIBRARY_CHANGED_DURING_READ:"El archivo cambió durante la lectura. Vuelve a revisarlo.",
  LIBRARY_EXPLICIT_APPROVAL_REQUIRED:"Vuelve a leer el documento y actívalo desde la ficha.",
  LIBRARY_DOCUMENT_TOO_LARGE:"El documento supera el límite de lectura para esta biblioteca. Divide el archivo en partes más pequeñas.",
  LIBRARY_ROOT_DISABLED:"La carpeta está desactivada. Sus documentos no se publican.",
  LIBRARY_INVALID_DATE:"Revisa las fechas. Emisión y vigencia no son lo mismo.",
  LIBRARY_RESOURCE_INVALID:"Introduce el enlace o ID válido de una hoja de Google Sheets.",
  LIBRARY_RESOURCE_CONFLICT:"Directorio y exportación deben ser archivos distintos, sin configuraciones duplicadas.",
  COMMIT_OUTCOME_UNKNOWN:"El acuse de guardado es incierto. Recarga la biblioteca antes de repetir."
};
function failure(e:unknown){
  const code=e instanceof PersistenceError?e.code:"LIBRARY_UNAVAILABLE";
  return Response.json({code,error:messages[code]??"No se confirmó la operación. Revisa enlace, formato y permisos; no se publicó contenido."},
    {status:code==="ACCESS_DENIED"?403:400,headers});
}
export const GET:RequestHandler=async({cookies})=>{
  const a=await readAccessSession(cookies.get("rh_session"));
  if(!a)return Response.json({error:"Acceso autenticado requerido"},{status:401,headers});
  try{return Response.json(await libraryView(getNeonPool(),a),{headers});}catch(e){return failure(e);}
};
export const POST:RequestHandler=async({cookies,request})=>{
  const a=await readAccessSession(cookies.get("rh_session"));
  if(!a)return Response.json({error:"Acceso autenticado requerido"},{status:401,headers});
  if(!sameOrigin(request))return Response.json({error:"Origen no autorizado"},{status:403,headers});
  try{
    const body=await readJsonObject(request,40000);
    if(String(body.action)!=="read"&&!isOwner(a))
      return Response.json({code:"ACCESS_DENIED",error:messages.ACCESS_DENIED},{status:403,headers});
    return Response.json({ok:true,...await libraryAction(getNeonPool(),a,body)},{headers});
  }
  catch(e){return failure(e);}
};
