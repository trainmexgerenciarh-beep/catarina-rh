import type {RequestHandler} from "@sveltejs/kit";
import {sameOrigin} from "../../../../lib/server/admin-auth";
import {readAccessSession as readSession} from "../../../../lib/server/admin-access-auth";
import {getNeonPool} from "../../../../lib/server/neon-collaborators";
import {readRH,writeRH} from "../../../../lib/server/rh-service";
import {exportMonth,inspectExportDestination} from "../../../../lib/server/monthly-export";
import {PersistenceError} from "../../../../lib/server/persistence-unit";
import {readJsonObject} from "../../../../lib/server/request-json";
const messages:Record<string,string>={
  ACCESS_DENIED:"Tu perfil no tiene permiso para esta acción.",
  LIBRARY_REVIEW_REQUIRED:"Usa Biblioteca documental: la publicación requiere aprobación de fragmentos, no solo activar un enlace.",
  INVALID_INPUT:"Revisa los campos obligatorios y sus formatos.",
  PHONE_ALREADY_REGISTERED:"Ese WhatsApp ya pertenece a otro registro. No se guardó un duplicado.",
  DRIVE_READ_NOT_CONFIRMED:"No se pudo confirmar la lectura de Drive. Revisa permisos y tipo de archivo.",
  SHEETS_DESTINATION_REQUIRED:"El titular debe configurar primero el destino autorizado de Google Sheets.",
  SHEETS_DESTINATION_CONFLICT:"La configuración privada apunta a otra hoja. No se exportó; el único destino permitido es la hoja de prueba entregada por Trainmex.",
  SHEETS_PERMISSION_REQUIRED:"La identidad conectada no tiene el permiso requerido para ese archivo.",
  SHEETS_TRACE_CONFLICT:"La hoja contiene identificadores duplicados o datos incompatibles. No se archivó el lote.",
  SHEETS_VERIFICATION_REQUIRED:"No se confirmó la escritura completa en Sheets. Reintenta después de revisar el destino.",
  PERSISTENCE_BUSY:"Otra operación está en curso. Espera y vuelve a intentarlo.",
  APPOINTMENT_NOT_ENDED:"La cita debe haber terminado y conservar el estado programada para registrar atención.",
  BLOCK_CONFLICTS_WITH_APPOINTMENT:"Ese bloqueo se cruza con una cita programada. No se guardó.",
  SURVEY_ALREADY_ANSWERED:"La encuesta ya tiene una respuesta; no se sobrescribió."
};
const errorResponse=(e:unknown)=>Response.json({error:e instanceof PersistenceError?(messages[e.code]??"No se pudo confirmar la operación."): "Operación no disponible; no se confirma ningún cambio",
  code:e instanceof PersistenceError?e.code:"OPERATION_UNAVAILABLE"},
  {status:e instanceof PersistenceError&&e.code==="ACCESS_DENIED"?403:400});
export const GET:RequestHandler=async({cookies,params})=>{
  const admin=await readSession(cookies.get("rh_session"));
  if(!admin)return Response.json({error:"Acceso autenticado requerido"},{status:401});
  if(params.resource==="voz"&&admin.role!=="gerente")return Response.json({error:"ACCESS_DENIED"},{status:403});
  try{return Response.json({rows:await readRH(getNeonPool(),params.resource!,admin.role),mode:"neon",role:admin.role},{headers:{"cache-control":"no-store"}});}
  catch(e){return errorResponse(e);}
};
export const POST:RequestHandler=async({cookies,params,request})=>{
  const admin=await readSession(cookies.get("rh_session"));
  if(!admin)return Response.json({error:"Acceso autenticado requerido"},{status:401});
  if(params.resource==="voz")return Response.json({error:"ACCESS_DENIED"},{status:403});
  if(!sameOrigin(request))return Response.json({error:"Origen no autorizado"},{status:403});
  try{
    const body=await readJsonObject(request);
    if(!body.data||typeof body.data!=="object"||Array.isArray(body.data))throw new PersistenceError("INVALID_INPUT");
    if(admin.role!=="gerente"&&((params.resource==="servicios"||params.resource==="fuentes")&&body.action==="save"||
      params.resource==="configuracion"&&["export","check-export"].includes(String(body.action))))throw new PersistenceError("ACCESS_DENIED");
    const row=params.resource==="configuracion"&&body.action==="check-export"?await inspectExportDestination():
      params.resource==="configuracion"&&body.action==="export"?
      await exportMonth(getNeonPool(),String((body.data as Record<string,unknown>).month)):
      await writeRH(getNeonPool(),params.resource!,String(body.action),body.data as Record<string,unknown>,admin.role,admin.email);
    return Response.json({ok:true,row});
  }catch(e){return errorResponse(e);}
};
