import {readAccessSession as readSession,adminConfigured} from "../../../../lib/server/admin-access-auth";
import type {RequestHandler} from "@sveltejs/kit";
import {isOwner} from "../../../../lib/server/admin-users";
export const GET:RequestHandler=async({cookies})=>{
  const admin=await readSession(cookies.get("rh_session"));
  return Response.json({authenticated:Boolean(admin),configured:adminConfigured(),principal:isOwner(admin),...admin},{headers:{"cache-control":"no-store"}});
};
