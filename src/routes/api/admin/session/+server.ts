import {readSession,adminConfigured} from "../../../../lib/server/admin-auth";
import type {RequestHandler} from "@sveltejs/kit";
export const GET:RequestHandler=({cookies})=>{
  const admin=readSession(cookies.get("rh_session"));
  return Response.json({authenticated:Boolean(admin),configured:adminConfigured(),...admin},{headers:{"cache-control":"no-store"}});
};
