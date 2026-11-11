import {sameOrigin,revokeSession} from "../../../../lib/server/admin-auth";
import type {RequestHandler} from "@sveltejs/kit";
export const POST:RequestHandler=({request,cookies})=>{
  if(!sameOrigin(request))return Response.json({error:"Origen no autorizado"},{status:403});
  revokeSession(cookies.get("rh_session"));
  cookies.delete("rh_session",{path:"/",httpOnly:true,secure:true,sameSite:"strict"});return Response.json({ok:true});
};
