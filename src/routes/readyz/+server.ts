import type {RequestHandler} from "@sveltejs/kit";
import {readSession} from "../../lib/server/admin-auth";
import {checkCronAuth} from "../../lib/server/cron-auth";
import {getNeonPool} from "../../lib/server/neon-collaborators";
import {neonTlsVerified} from "../../lib/server/postgres-config";
export const GET:RequestHandler=async({cookies,request})=>{
  if(!readSession(cookies.get("rh_session"))&&checkCronAuth(request)!=="AUTHORIZED")
    return Response.json({error:"UNAUTHORIZED"},{status:401});
  try{
    const c=await getNeonPool().connect();
    try{
    const r=(await c.query(`SELECT
      (SELECT count(*) FROM pg_tables WHERE schemaname='public')::int AS tables,
      (SELECT count(*) FROM public.servicios WHERE activo IS TRUE)::int AS services,
      (SELECT count(*) FROM public.horarios_atencion WHERE activo IS TRUE)::int AS hours`)).rows[0];
    return Response.json({ready:false,connections:{neon:neonTlsVerified(c)},expected:{tables:r.tables===14,services:r.services===15,hours:r.hours===5},
      timezone:"America/Mexico_City",outbound:"OFF",blocker:"DURABLE_DELIVERY_SCHEMA_APPROVAL_REQUIRED"},{status:503});
    }finally{c.release();}
  }catch{return Response.json({ready:false,error:"DATABASE_UNAVAILABLE",outbound:"OFF"},{status:503});}
};
