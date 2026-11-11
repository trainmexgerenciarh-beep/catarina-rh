import {error} from "@sveltejs/kit";
import {readAccessSession} from "../../lib/server/admin-access-auth";
import {isOwner} from "../../lib/server/admin-users";
import type {PageServerLoad} from "./$types";
export const load:PageServerLoad=async({url,cookies})=>{
  if(["usuarios","importar"].includes(url.searchParams.get("resource")??"")){
    const a=await readAccessSession(cookies.get("rh_session"));
    if(!a)error(401,"Acceso autenticado requerido");
    if(!isOwner(a))error(403,"Acceso exclusivo del administrador principal");
  }
  return {};
};
