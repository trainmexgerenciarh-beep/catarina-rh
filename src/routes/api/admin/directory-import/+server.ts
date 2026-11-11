import type {RequestHandler} from "@sveltejs/kit";
import {readAccessSession} from "../../../../lib/server/admin-access-auth";
import {isOwner} from "../../../../lib/server/admin-users";
import {sameOrigin} from "../../../../lib/server/admin-auth";
import {getNeonPool} from "../../../../lib/server/neon-collaborators";
import {handleDirectoryImport,IMPORT_MAX_BYTES} from "../../../../lib/server/directory-import";
import {readJsonObject} from "../../../../lib/server/request-json";
import {PersistenceError} from "../../../../lib/server/persistence-unit";
const headers={"cache-control":"no-store"};
const messages:Record<string,string>={
  IMPORT_SHEET_PERMISSION:"Replit no pudo leer la hoja. Revisa el permiso de la identidad conectada o usa CSV/pegado privado.",
  IMPORT_SHEET_UNAVAILABLE:"La hoja no está disponible. Usa CSV/pegado privado o vuelve a intentar.",
  IMPORT_HEADERS_INVALID:"Revisa encabezados: número de empleado, nombre completo, departamento, WhatsApp, puesto, estatus. Centro es opcional.",
  IMPORT_PREVIEW_EXPIRED:"Cambió el archivo, el directorio o venció la vista previa. Genera una nueva antes de confirmar.",
  IMPORT_CONFIRMATION_REQUIRED:"Falta una vista previa válida y confirmada.",
  IMPORT_TOO_MANY_ROWS:"Divide el archivo en lotes de hasta 200 colaboradores.",
  IMPORT_NOTHING_TO_INSERT:"No hay altas válidas. No se sobrescriben registros existentes.",
  COMMIT_OUTCOME_UNKNOWN:"No se pudo confirmar el acuse. Vuelve a previsualizar: no repitas una confirmación incierta.",
  IMPORT_CONFIGURATION_REQUIRED:"La configuración privada de sesión está pendiente."
};
export const POST:RequestHandler=async({request,cookies})=>{
  const a=await readAccessSession(cookies.get("rh_session"));
  if(!a)return Response.json({error:"Acceso autenticado requerido"},{status:401,headers});
  if(!isOwner(a)||!sameOrigin(request))return Response.json({error:"Acceso exclusivo del administrador principal"},{status:403,headers});
  try{
    const body=await readJsonObject(request,IMPORT_MAX_BYTES+8192);
    return Response.json(await handleDirectoryImport(getNeonPool(),a,body),{headers});
  }catch(e){
    const code=e instanceof PersistenceError?e.code:"IMPORT_INVALID_INPUT";
    return Response.json({error:messages[code]??"No se confirmó la importación. Revisa el archivo y genera una vista previa.",code},{status:400,headers});
  }
};
