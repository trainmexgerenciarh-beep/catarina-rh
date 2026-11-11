import type {RequestHandler} from "@sveltejs/kit";
import {readAccessSession} from "../../../../lib/server/admin-access-auth";
import {sameOrigin} from "../../../../lib/server/admin-auth";
import {getNeonPool} from "../../../../lib/server/neon-collaborators";
import {isOwner,listAccess,changeAccess,AccessError} from "../../../../lib/server/admin-users";
import {readJsonObject} from "../../../../lib/server/request-json";
export const GET:RequestHandler=async({cookies})=>{
  const a=await readAccessSession(cookies.get("rh_session"));
  if(!a||!isOwner(a))return Response.json({error:"Acceso exclusivo del administrador principal"},{status:a?403:401});
  try{return Response.json(await listAccess(getNeonPool(),a));}
  catch{return Response.json({error:"Administración no disponible"},{status:503});}
};
export const POST:RequestHandler=async({cookies,request})=>{
  const a=await readAccessSession(cookies.get("rh_session"));
  if(!a||!isOwner(a))return Response.json({error:"Acceso exclusivo del administrador principal"},{status:a?403:401});
  if(!sameOrigin(request))return Response.json({error:"Origen no autorizado"},{status:403});
  try{return Response.json(await changeAccess(getNeonPool(),a,await readJsonObject(request)));}
  catch(e){return Response.json({error:e instanceof AccessError?e.message:"No se confirmó el cambio; revisa si el correo ya existe"},{status:400});}
};
