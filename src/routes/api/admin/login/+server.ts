import { verifyLogin, signSession, sameOrigin, adminConfigured } from "../../../../lib/server/admin-auth";
import type {RequestHandler} from "@sveltejs/kit";
import {readJsonObject} from "../../../../lib/server/request-json";
const attempts=new Map<string,{n:number;until:number}>();
export const POST:RequestHandler=async({request,cookies})=>{
  if(!sameOrigin(request))return Response.json({error:"Origen no autorizado"},{status:403});
  if(!adminConfigured())return Response.json({error:"Acceso administrativo pendiente de configuración autorizada. La demostración aislada está disponible."},{status:503});
  let data:Record<string,unknown>;
  try{data=await readJsonObject(request);}catch{return Response.json({error:"Solicitud JSON no válida"},{status:400});}
  const email=String(data.email??"").trim().toLowerCase().slice(0,254);
  const key=createKey(email),now=Date.now();
  for(const [k,v]of attempts)if(v.until<=now)attempts.delete(k);
  if(attempts.size>=1000&&!attempts.has(key))return Response.json({error:"Intenta más tarde"},{status:429});
  const attempt=attempts.get(key)??{n:0,until:now+900000};attempts.set(key,attempt);
  if(++attempt.n>5)return Response.json({error:"Intenta más tarde"},{status:429});
  const admin=verifyLogin(email,String(data.password??""));
  if(!admin)return Response.json({error:"Acceso no autorizado"},{status:401});
  attempts.delete(key);
  let token:string;
  try{token=signSession(admin);}catch{return Response.json({error:"Inicio de sesión no disponible"},{status:503});}
  cookies.set("rh_session",token,{path:"/",httpOnly:true,secure:true,sameSite:"strict",maxAge:28800});
  return Response.json({ok:true});
};
import {createHash} from "node:crypto";
const createKey=(value:string)=>createHash("sha256").update(value).digest("hex");
