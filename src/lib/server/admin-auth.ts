import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";
export type Role = "generalista" | "gerente";
export type Admin = {email:string;role:Role};
type Account = Admin & {salt:string;hash:string};
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
/** No bootstrap identity is inferred. Missing/invalid allowlist fails closed. */
function accounts():Account[] {
  try {
    const list=JSON.parse(process.env.RH_ADMIN_ACCOUNTS??"[]");
    if(!Array.isArray(list))return [];
    return list.filter(a=>typeof a.email==="string"&&["generalista","gerente"].includes(a.role)&&
      typeof a.salt==="string"&&/^[a-f0-9]{32,128}$/.test(a.salt)&&/^[a-f0-9]{128}$/.test(a.hash));
  }catch{return [];}
}
export const adminConfigured=()=>Boolean(process.env.SESSION_SECRET)&&accounts().length>0;
export function verifyLogin(email:string,password:string):Admin|null {
  if(!adminConfigured()||password.length>256)return null;
  const a=accounts().find(a=>a.email.toLowerCase()===email.toLowerCase());
  const actual=scryptSync(password,a?.salt??"invalid-account-salt",64).toString("hex");
  return a&&equal(actual,a.hash)?{email:a.email,role:a.role}:null;
}
export function signSession(admin:Admin):string {
  const body=Buffer.from(JSON.stringify({...admin,expires:Date.now()+8*3600000,nonce:randomBytes(16).toString("hex")})).toString("base64url");
  return body+"."+createHmac("sha256",process.env.SESSION_SECRET!).update(body).digest("base64url");
}
export function readSession(token:string|undefined):Admin|null {
  if(!token||!adminConfigured())return null;
  try{
    const [body,mac,...rest]=token.split(".");
    if(rest.length||!equal(mac,createHmac("sha256",process.env.SESSION_SECRET!).update(body).digest("base64url")))return null;
    const a=JSON.parse(Buffer.from(body,"base64url").toString());
    if(a.expires<Date.now()||!accounts().some(x=>x.email===a.email&&x.role===a.role))return null;
    return {email:a.email,role:a.role};
  }catch{return null;}
}
export function sameOrigin(request:Request):boolean {
  const origin=request.headers.get("origin");
  if(!origin)return false;
  if(origin===new URL(request.url).origin)return true;
  // Replit preview terminates HTTPS before Vite; request.url can include its
  // internal port. Trust only the platform's configured dev host, NEVER an
  // arbitrary forwarded header or suffix match. Production fails closed.
  const preview=process.env.NODE_ENV!=="production"&&process.env.REPLIT_DEV_DOMAIN;
  return Boolean(preview&&origin===`https://${preview}`);
}
