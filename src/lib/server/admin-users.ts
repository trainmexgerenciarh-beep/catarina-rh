import type pg from "pg";
import type {Admin} from "./admin-auth.ts";
export const OWNER_EMAIL="trainmexgerenciarh@gmail.com";
export const INITIAL_MANAGER_EMAIL="trainmexrh@gmail.com";
export const isOwner=(a:Admin|null)=>a?.role==="gerente"&&a.email===OWNER_EMAIL;
export class AccessError extends Error{}
const email=(v:unknown)=>{
  const s=String(v??"").trim().toLowerCase();
  if(s.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw new AccessError("Correo no válido");
  return s;
};
export async function accountAccess(pool:pg.Pool,address:string){
  return (await pool.query("SELECT email,role,activo,revision::text FROM public.usuarios_rh WHERE email=$1",[address.toLowerCase()])).rows[0]??null;
}
export async function listAccess(pool:pg.Pool,actor:Admin){
  if(!isOwner(actor))throw new AccessError("Acceso exclusivo del administrador principal");
  const rows=(await pool.query("SELECT email,role,activo,revision::text FROM public.usuarios_rh ORDER BY role DESC,email")).rows;
  const audit=(await pool.query("SELECT actor,accion,cuenta,fecha FROM public.auditoria_accesos ORDER BY id DESC LIMIT 100")).rows;
  return {rows,audit};
}
export async function changeAccess(pool:pg.Pool,actor:Admin,d:Record<string,unknown>){
  if(!isOwner(actor))throw new AccessError("Acceso exclusivo del administrador principal");
  const target=email(d.email),action=String(d.action);
  if(target===OWNER_EMAIL||d.role&&d.role!=="generalista")throw new AccessError("El administrador principal no puede modificarse");
  if(!["add","edit","activate","deactivate","revoke"].includes(action))throw new AccessError("Acción no válida");
  const next=action==="edit"?email(d.newEmail):target;
  if(next===OWNER_EMAIL)throw new AccessError("Cuenta protegida");
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='3s'");
    await c.query("SET LOCAL statement_timeout='8s'");
    // Serialize administration; recheck authority INSIDE the write transaction.
    await c.query("SELECT pg_advisory_xact_lock(7412061)");
    const root=(await c.query("SELECT 1 FROM public.usuarios_rh WHERE email=$1 AND role='gerente' AND activo FOR UPDATE",[actor.email])).rowCount;
    if(!root)throw new AccessError("Administrador no habilitado");
    const current=(await c.query("SELECT role FROM public.usuarios_rh WHERE email=$1 FOR UPDATE",[target])).rows[0];
    if(action==="add"){
      if(current)throw new AccessError("La cuenta ya existe");
      await c.query("INSERT INTO public.usuarios_rh(email,role,activo) VALUES($1,'generalista',true)",[target]);
    }else{
      if(!current||current.role!=="generalista")throw new AccessError("Gestor no encontrado");
      await c.query(`UPDATE public.usuarios_rh SET email=$2,activo=CASE WHEN $3 IN ('deactivate','revoke') THEN false
        WHEN $3='activate' THEN true ELSE activo END,revision=revision+1 WHERE email=$1`,[target,next,action]);
    }
    await c.query("INSERT INTO public.auditoria_accesos(actor,accion,cuenta) VALUES($1,$2,$3)",[actor.email,action,action==="edit"?`${target} → ${next}`:target]);
    await c.query("COMMIT");return {ok:true};
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
