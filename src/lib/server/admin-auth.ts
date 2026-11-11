import {createHmac,createHash,timingSafeEqual,scryptSync,randomBytes} from "node:crypto";
export type Role="generalista"|"gerente";
export type Admin={email:string;role:Role};
type Account=Admin&{salt:string;hash:string};
type Session=Admin&{expires:number;credentialVersion:string};
const sessions=new Map<string,Session>(),TTL=8*3600000,MAX_SESSIONS=5000;
const equal=(a:unknown,b:unknown)=>{
  if(typeof a!=="string"||typeof b!=="string")return false;
  const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);
};
function accounts():Account[]{
  try{
    const list=JSON.parse(process.env.RH_ADMIN_ACCOUNTS??"[]");
    if(!Array.isArray(list)||!list.length)return [];
    const emails=new Set<string>();
    for(const a of list){
      if(!a||typeof a.email!=="string"||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)||
        !["generalista","gerente"].includes(a.role)||typeof a.salt!=="string"||
        !/^[a-f0-9]{32,128}$/.test(a.salt)||typeof a.hash!=="string"||!/^[a-f0-9]{128}$/.test(a.hash))
        return [];
      const email=a.email.toLowerCase();if(emails.has(email))return [];emails.add(email);
    }
    return list;
  }catch{return [];}
}
const version=(a:Account)=>createHash("sha256").update(JSON.stringify([a.email,a.role,a.salt,a.hash])).digest("hex");
export const adminConfigured=()=>Boolean(process.env.SESSION_SECRET)&&accounts().length>0;
export function verifyLogin(email:string,password:string):Admin|null{
  if(!adminConfigured()||!password||password.length>256||email.length>254)return null;
  const a=accounts().find(a=>a.email.toLowerCase()===email.toLowerCase());
  const actual=scryptSync(password,a?.salt??"invalid-account-salt",64).toString("hex");
  return a&&equal(actual,a.hash)?{email:a.email,role:a.role}:null;
}
const mac=(id:string)=>createHmac("sha256",process.env.SESSION_SECRET!).update(id).digest("base64url");
/** Opaque, revocable sessions. A restart/other process fails CLOSED, not open.
 * Admin UI requires single instance/sticky routing until shared session storage
 * is authorized. Conversation leases in Neon are independent of this map.
 */
export function signSession(admin:Admin):string{
  if(!adminConfigured())throw new Error("ADMIN_NOT_CONFIGURED");
  const a=accounts().find(a=>a.email===admin.email&&a.role===admin.role);
  if(!a)throw new Error("ADMIN_NOT_AUTHORIZED");
  for(const [id,s]of sessions)if(s.expires<=Date.now())sessions.delete(id);
  if(sessions.size>=MAX_SESSIONS)throw new Error("SESSION_CAPACITY");
  const id=randomBytes(32).toString("base64url");
  sessions.set(id,{...admin,expires:Date.now()+TTL,credentialVersion:version(a)});
  return id+"."+mac(id);
}
export function readSession(token:string|undefined):Admin|null{
  if(!adminConfigured()){sessions.clear();return null;}
  if(!token||token.length>128)return null;
  const [id,signature,...rest]=token.split(".");
  if(rest.length||!equal(signature,mac(id)))return null;
  const s=sessions.get(id),a=accounts().find(a=>a.email===s?.email&&a.role===s?.role);
  if(!s||!a||s.expires<=Date.now()||s.credentialVersion!==version(a)){sessions.delete(id);return null;}
  return {email:s.email,role:s.role};
}
export function revokeSession(token:string|undefined){
  if(!token||!process.env.SESSION_SECRET)return;
  const [id,signature,...rest]=token.split(".");
  if(!rest.length&&equal(signature,mac(id)))sessions.delete(id);
}
export function sameOrigin(request:Request):boolean{
  if(request.headers.get("sec-fetch-site")==="cross-site")return false;
  const origin=request.headers.get("origin");
  if(!origin||origin==="null")return false;
  if(origin===new URL(request.url).origin)return true;
  const preview=process.env.NODE_ENV!=="production"&&process.env.REPLIT_DEV_DOMAIN;
  return Boolean(preview&&origin===`https://${preview}`);
}
