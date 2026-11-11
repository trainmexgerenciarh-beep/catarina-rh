import type {RequestHandler} from "@sveltejs/kit";
import {readSession,adminConfigured} from "../../lib/server/admin-auth";
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
      (SELECT count(*) FROM public.horarios_atencion WHERE activo IS TRUE)::int AS hours,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='encuestas' AND column_name='entrega' AND data_type='jsonb'
        AND is_nullable='YES') AS delivery,
      (SELECT count(*) FROM public.fuentes WHERE activo IS TRUE)::int AS sources`)).rows[0];
    const technicalReady=neonTlsVerified(c)&&r.tables===14&&r.services===15&&r.hours===5&&r.delivery;
    const pending=["REAL_WHATSAPP_DISABLED","HOSTING_AND_CRON_REVIEW_REQUIRED"];
    if(!adminConfigured())pending.push("RH_ACCOUNTS_REQUIRED");
    if(!r.sources)pending.push("APPROVED_SOURCES_REQUIRED");
    if(!process.env.RH_EXPORT_SPREADSHEET_ID)pending.push("SHEETS_TEST_DESTINATION_REQUIRED");
    if(!process.env.CRON_SECRET)pending.push("CRON_AUTH_REQUIRED");
    return Response.json({ready:false,technicalReady,connections:{neon:neonTlsVerified(c)},
      expected:{tables:r.tables===14,services:r.services===15,hours:r.hours===5,deliveryColumn:r.delivery},
      timezone:"America/Mexico_City",outbound:"OFF",
      blocker:technicalReady?"EXTERNAL_ACTIVATION_PENDING":"TECHNICAL_READINESS_FAILED",pending},{status:503});
    }finally{c.release();}
  }catch{return Response.json({ready:false,error:"DATABASE_UNAVAILABLE",outbound:"OFF"},{status:503});}
};
