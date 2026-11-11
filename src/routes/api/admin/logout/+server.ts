import {sameOrigin} from "../../../../lib/server/admin-auth";
import type {RequestHandler} from "@sveltejs/kit";
export const POST:RequestHandler=({request,cookies})=>{
  if(!sameOrigin(request))return Response.json({error:"Origen no autorizado"},{status:403});
  cookies.delete("rh_session",{path:"/"});return Response.json({ok:true});
};
