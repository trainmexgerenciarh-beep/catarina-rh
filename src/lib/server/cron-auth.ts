import {timingSafeEqual} from "node:crypto";
export function checkCronAuth(request:Request,secret=process.env.CRON_SECRET){
  if(!secret||secret.length<32)return "NOT_CONFIGURED" as const;
  if(new URL(request.url).search)return "INVALID" as const;
  const auth=request.headers.get("authorization")??"",expected=`Bearer ${secret}`;
  const a=Buffer.from(auth),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b)?"AUTHORIZED" as const:"INVALID" as const;
}
