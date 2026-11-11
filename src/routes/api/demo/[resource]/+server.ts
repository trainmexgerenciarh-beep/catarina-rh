import type {RequestHandler} from "@sveltejs/kit";
import {getDemo} from "../../../../lib/server/demo-store";
import {sameOrigin} from "../../../../lib/server/admin-auth";
export const GET:RequestHandler=({cookies,params})=>{
  try{
    const demo=getDemo(cookies.get("rh_demo"));
    cookies.set("rh_demo",demo.id,{path:"/",httpOnly:true,secure:true,sameSite:"strict",maxAge:7200});
    return Response.json({rows:demo.store.read(params.resource!),mode:"demo",role:"gerente"},{headers:{"cache-control":"no-store"}});
  }catch{return Response.json({error:"Demostración no disponible"},{status:400});}
};
export const POST:RequestHandler=async({cookies,params,request})=>{
  if(!sameOrigin(request))return Response.json({error:"Origen no autorizado"},{status:403});
  try{
    const demo=getDemo(cookies.get("rh_demo")),body=await request.json();
    cookies.set("rh_demo",demo.id,{path:"/",httpOnly:true,secure:true,sameSite:"strict",maxAge:7200});
    if(params.resource==="conversation")return Response.json(await demo.store.conversation(String(body.text??""),String(body.eventId??""),body.reset===true));
    if(!body.data||typeof body.data!=="object")throw new Error("Datos requeridos");
    await demo.store.write(params.resource!,String(body.action),body.data);
    return Response.json({ok:true});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"Acción de demostración no disponible"},{status:400});}
};
