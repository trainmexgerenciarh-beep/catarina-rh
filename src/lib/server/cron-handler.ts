import {checkCronAuth} from "./cron-auth.ts";
import {readJsonObject} from "./request-json.ts";
export function createCronHandler(options:{
  secret?:()=>string|undefined;
  prepare:()=>Promise<{prepared:number;outbound:boolean}>;
}){
  return async({request}:{request:Request})=>{
    const auth=checkCronAuth(request,options.secret?.());
    if(auth!=="AUTHORIZED")return Response.json({error:auth==="NOT_CONFIGURED"?"CRON_NOT_CONFIGURED":"UNAUTHORIZED"},
      {status:auth==="NOT_CONFIGURED"?503:401,headers:{"cache-control":"no-store"}});
    let task:unknown;
    try{const body=await readJsonObject(request);if(Object.keys(body).some(k=>k!=="task"))throw new Error();task=body.task;}
    catch{return Response.json({error:"INVALID_CRON_REQUEST"},{status:400});}
    if(task==="dispatch")return Response.json({error:"DURABLE_DELIVERY_SCHEMA_APPROVAL_REQUIRED",outbound:"OFF"},{status:409});
    if(task!=="prepare")return Response.json({error:"INVALID_TASK"},{status:400});
    try{
      const result=await options.prepare();
      return Response.json({prepared:result.prepared,committed:true,outbound:"OFF",
        dispatch:"BLOCKED_SCHEMA_APPROVAL_REQUIRED"},{headers:{"cache-control":"no-store"}});
    }catch{return Response.json({error:"PREPARATION_NOT_CONFIRMED",outbound:"OFF"},{status:503});}
  };
}
