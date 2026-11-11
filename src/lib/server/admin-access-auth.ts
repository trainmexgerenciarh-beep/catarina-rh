import {adminConfigured,verifyLogin,readSession,signSession,type Admin} from "./admin-auth.ts";
import {accountAccess,OWNER_EMAIL} from "./admin-users.ts";
import {getNeonPool} from "./neon-collaborators.ts";
import type pg from "pg";
const revisions=new Map<string,{revision:string;expires:number}>();
async function allowed(a:Admin,pool?:pg.Pool){
  const row=await accountAccess(pool??getNeonPool(),a.email);
  if(!row?.activo||row.role!==a.role||a.role==="gerente"&&a.email!==OWNER_EMAIL)return null;
  return row;
}
export async function loginWithAccess(email:string,password:string,pool?:pg.Pool){
  const a=verifyLogin(email,password);if(!a)return null;
  if((pool||process.env.DATABASE_URL)&&!await allowed(a,pool))return null;
  return a;
}
export async function signAccessSession(a:Admin,pool?:pg.Pool){
  const row=pool||process.env.DATABASE_URL?await allowed(a,pool):null;
  if((pool||process.env.DATABASE_URL)&&!row)throw Error("ACCESS_DENIED");
  const token=signSession(a);
  for(const [key,value] of revisions)if(value.expires<=Date.now())revisions.delete(key);
  if(revisions.size>=5000)throw Error("SESSION_CAPACITY");
  if(row)revisions.set(token,{revision:row.revision,expires:Date.now()+8*3600000});
  return token;
}
export async function readAccessSession(token:string|undefined,pool?:pg.Pool):Promise<Admin|null>{
  const a=readSession(token);if(!a)return null;
  if(!pool&&!process.env.DATABASE_URL)return a; // Isolated HTTPS test server, no database credentials.
  try{
    const row=await allowed(a,pool);
    if(!row||row.revision!==revisions.get(token!)?.revision){revisions.delete(token!);return null;}
    return a;
  }catch{return null;} // Database unavailable is never authorization.
}
export {adminConfigured};
