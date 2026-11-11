import type {RequestHandler} from "@sveltejs/kit";
import {readSession,sameOrigin} from "../../../../lib/server/admin-auth";
import {getNeonPool} from "../../../../lib/server/neon-collaborators";
import {readRH,writeRH} from "../../../../lib/server/rh-service";
import {exportMonth} from "../../../../lib/server/monthly-export";
import {PersistenceError} from "../../../../lib/server/persistence-unit";
const errorResponse=(e:unknown)=>Response.json({error:e instanceof PersistenceError?e.code:"Operación no disponible; no se confirma ningún cambio"},
  {status:e instanceof PersistenceError&&e.code==="ACCESS_DENIED"?403:400});
export const GET:RequestHandler=async({cookies,params})=>{
  const admin=readSession(cookies.get("rh_session"));
  if(!admin)return Response.json({error:"Acceso autenticado requerido"},{status:401});
  try{return Response.json({rows:await readRH(getNeonPool(),params.resource!,admin.role),mode:"neon",role:admin.role},{headers:{"cache-control":"no-store"}});}
  catch(e){return errorResponse(e);}
};
export const POST:RequestHandler=async({cookies,params,request})=>{
  const admin=readSession(cookies.get("rh_session"));
  if(!admin)return Response.json({error:"Acceso autenticado requerido"},{status:401});
  if(!sameOrigin(request))return Response.json({error:"Origen no autorizado"},{status:403});
  try{
    const body=await request.json();
    if(!body.data||typeof body.data!=="object")throw new PersistenceError("INVALID_INPUT");
    const row=params.resource==="configuracion"&&body.action==="export"?
      await exportMonth(getNeonPool(),String(body.data.month)):
      await writeRH(getNeonPool(),params.resource!,body.action,body.data,admin.role);
    return Response.json({ok:true,row});
  }catch(e){return errorResponse(e);}
};
