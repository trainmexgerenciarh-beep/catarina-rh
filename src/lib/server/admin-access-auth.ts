import {adminConfigured,verifyLogin,readSession,signSession,type Admin} from "./admin-auth.ts";
import {accountAccess,INITIAL_MANAGER_EMAIL,OWNER_EMAIL} from "./admin-users.ts";
import {getNeonPool} from "./neon-collaborators.ts";
import type pg from "pg";
const revisions=new Map<string,{revision:string;expires:number}>();
/** Only a validated private credential set with exactly the two approved
 * identities can activate an empty access table on the first verified owner login. */
function initialAccounts():Admin[]|null{
  try{
    const rows=JSON.parse(process.env.RH_ADMIN_ACCOUNTS??"[]");
    if(!Array.isArray(rows)||rows.length!==2)return null;
    const owner=rows.find((r:any)=>typeof r.email==="string"&&r.email.toLowerCase()===OWNER_EMAIL&&r.role==="gerente");
    const manager=rows.find((r:any)=>typeof r.email==="string"&&r.email.toLowerCase()===INITIAL_MANAGER_EMAIL&&r.role==="generalista");
    if(!owner||!manager||owner===manager)return null;
    return [{email:OWNER_EMAIL,role:"gerente"},{email:INITIAL_MANAGER_EMAIL,role:"generalista"}];
  }catch{return null;}
}

async function bootstrapAfterVerifiedOwnerLogin(a:Admin,pool:pg.Pool):Promise<boolean>{
  if(a.email!==OWNER_EMAIL||a.role!=="gerente")return false;
  const expected=initialAccounts();if(!expected)return false;
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='3s'");
    await c.query("SET LOCAL statement_timeout='8s'");
    await c.query("SELECT pg_advisory_xact_lock(7412061)");
    const rows=(await c.query("SELECT email,role,activo FROM public.usuarios_rh ORDER BY email FOR UPDATE")).rows;
    if(!rows.length){
      for(const user of expected){
        await c.query("INSERT INTO public.usuarios_rh(email,role) VALUES($1,$2)",[user.email,user.role]);
        await c.query("INSERT INTO public.auditoria_accesos(actor,accion,cuenta) VALUES($1,'bootstrap_verificado',$2)",[OWNER_EMAIL,user.email]);
      }
    }else if(rows.length!==expected.length||expected.some(user=>!rows.some((r:any)=>
      r.email===user.email&&r.role===user.role&&r.activo===true))){
      throw new Error("BOOTSTRAP_PRECONDITION_FAILED");
    }
    await c.query("COMMIT");return true;
  }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}
  finally{c.release();}
}
async function allowed(a:Admin,pool?:pg.Pool){
  const row=await accountAccess(pool??getNeonPool(),a.email);
  if(!row?.activo||row.role!==a.role||a.role==="gerente"&&a.email!==OWNER_EMAIL)return null;
  return row;
}
export async function loginWithAccess(email:string,password:string,pool?:pg.Pool){
  const a=verifyLogin(email,password);if(!a)return null;
  if(pool||process.env.DATABASE_URL){
    const db=pool??getNeonPool();
    let row=await accountAccess(db,a.email);
    if(!row){
      if(!await bootstrapAfterVerifiedOwnerLogin(a,db))return null;
      row=await accountAccess(db,a.email);
    }
    if(!row?.activo||row.role!==a.role||a.role==="gerente"&&a.email!==OWNER_EMAIL)return null;
  }
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
