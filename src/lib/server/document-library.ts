import type pg from "pg";
import type {Admin} from "./admin-auth.ts";
import {isOwner} from "./admin-users.ts";
import {driveId} from "./institutional-sources.ts";
import {dateField,folderId,LIBRARY_LOCK,libraryError,validateFragments,type LibraryMeta} from "./library-contract.ts";
import {driveMetadata,driveRequest,listLibraryTree,readLibraryDocument,type DriveRequest} from "./drive-library.ts";
import {getProjectResources,parseSheetId} from "./project-resources.ts";
type Row={id_fuente:string;nombre:string;categoria:string;url_drive:string;version:string|null;vigente_desde:string|null;activo:boolean;biblioteca:LibraryMeta|null};
const projection="id_fuente::text,nombre,categoria,url_drive,version,vigente_desde::text,activo,biblioteca";
const list=async(c:Pick<pg.Pool,"query">)=>(
  await c.query(`SELECT ${projection} FROM public.fuentes ORDER BY id_fuente`)
).rows as Row[];
const identifier=(value:unknown)=>{const s=String(value??"");if(!/^[1-9]\d*$/.test(s))return libraryError("LIBRARY_INVALID_ID");return s;};
const text=(v:unknown,max=180)=>{const s=String(v??"").trim();if(!s||s.length>max)return libraryError("LIBRARY_INVALID_INPUT");return s;};
function owner(actor:Admin){if(!isOwner(actor))libraryError("ACCESS_DENIED");}
export async function libraryView(pool:pg.Pool,actor:Admin){
  const all=await list(pool);
  // No raw content is stored/projected. Approved or proposed excerpts only.
  const documents=all.filter(r=>!r.biblioteca||r.biblioteca.kind==="document").map(r=>r.biblioteca?r:
    {...r,biblioteca:{v:1,kind:"document",driveId:"",status:"PENDIENTE_REVISION",type:"PROCEDIMIENTO_INTERNO",
      reason:"Fuente anterior sin aprobación delimitada; requiere revisión."}});
  return {documents,roots:all.filter(r=>r.biblioteca?.kind==="root"),
    resources:await getProjectResources(pool),categories:(await pool.query(`SELECT categoria FROM servicios WHERE activo
      UNION SELECT subcategoria AS categoria FROM servicios WHERE activo AND categoria='Políticas y procedimientos' ORDER BY categoria`)).rows.map(r=>r.categoria),
    principal:isOwner(actor)};
}
async function transaction<T>(pool:pg.Pool,actor:Admin,work:(c:pg.PoolClient)=>Promise<T>){
  const c=await pool.connect();let begun=false,committing=false,destroy=false;
  try{
    await c.query("BEGIN");begun=true;await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL statement_timeout='15s'");
    await c.query("SELECT pg_advisory_xact_lock($1::bigint)",[LIBRARY_LOCK]);
    const permitted=await c.query("SELECT role FROM usuarios_rh WHERE email=$1 AND activo FOR SHARE",[actor.email]);
    if(permitted.rows[0]?.role!==actor.role)libraryError("ACCESS_DENIED");
    const result=await work(c);
    committing=true;await c.query("COMMIT");begun=false;return result;
  }catch(e){
    if(begun)try{await c.query("ROLLBACK");}catch{destroy=true;}
    if(committing){destroy=true;libraryError("COMMIT_OUTCOME_UNKNOWN");}
    throw e;
  }finally{c.release(destroy);}
}
const audit=async(c:pg.PoolClient,actor:Admin,action:string,id:string)=>{
  await c.query("INSERT INTO auditoria_accesos(actor,accion,cuenta) VALUES($1,$2,$3)",[actor.email,"biblioteca_"+action,"fuente:"+id]);
};
async function saveMeta(c:pg.PoolClient,r:Row,meta:LibraryMeta,active=false){
  meta.revisionLocal=(r.biblioteca?.revisionLocal??0)+1;
  await c.query("UPDATE fuentes SET biblioteca=$2::jsonb,activo=$3 WHERE id_fuente=$1",[r.id_fuente,JSON.stringify(meta),active]);
}
async function rowById(c:Pick<pg.Pool,"query">,id:string){
  const r=(await c.query(`SELECT ${projection} FROM fuentes WHERE id_fuente=$1`,[id])).rows[0] as Row|undefined;
  if(!r)return libraryError("LIBRARY_NOT_FOUND");return r;
}
/** No Google calls inside transactions. Root revision fences slow sync against
 * disable/edit, and document local revision prevents a stale read approving data. */
export async function libraryAction(pool:pg.Pool,actor:Admin,d:Record<string,unknown>,request:DriveRequest=driveRequest){
  const action=String(d.action);
  if(!["manual","read","propose"].includes(action))owner(actor);
  if(action==="root-save"){
    const id=folderId(d.url),meta=await driveMetadata(id,request);
    if(meta.mimeType!=="application/vnd.google-apps.folder")libraryError("LIBRARY_INVALID_FOLDER");
    return transaction(pool,actor,async c=>{
      const rows=await list(c as unknown as pg.Pool);
      const previous=rows.find(r=>r.biblioteca?.kind==="root"&&r.biblioteca.driveId===id);
      if(previous){
        if(!previous.biblioteca?.enabled){await saveMeta(c,previous,{...previous.biblioteca!,enabled:true,error:undefined});await audit(c,actor,"carpeta_reactivada",previous.id_fuente);}
        return {alreadyRegistered:true};
      }
      const r=await c.query(`INSERT INTO fuentes(nombre,url_drive,categoria,activo,biblioteca) VALUES($1,$2,'CONFIGURACION_BIBLIOTECA',false,$3::jsonb) RETURNING id_fuente::text`,
        [String(d.name??"").trim().slice(0,180)||meta.name,`https://drive.google.com/drive/folders/${id}`,
          JSON.stringify({v:1,kind:"root",driveId:id,enabled:true,revisionLocal:1})]);
      await audit(c,actor,"carpeta",r.rows[0].id_fuente);return {id:r.rows[0].id_fuente};
    });
  }
  if(action==="resources"){
    const directoryId=parseSheetId(d.directoryUrl),exportId=parseSheetId(d.exportUrl);
    if(directoryId===exportId)libraryError("LIBRARY_RESOURCE_CONFLICT");
    return transaction(pool,actor,async c=>{
      const rows=await list(c as unknown as pg.Pool),existing=rows.find(r=>r.biblioteca?.kind==="resources");
      const json=JSON.stringify({v:1,kind:"resources",driveId:"project-resources",directoryId,exportId});
      let id;
      if(existing){id=existing.id_fuente;await c.query("UPDATE fuentes SET biblioteca=$2::jsonb WHERE id_fuente=$1",[id,json]);}
      else id=(await c.query("INSERT INTO fuentes(nombre,categoria,activo,biblioteca) VALUES('Recursos de prueba del proyecto','CONFIGURACION_BIBLIOTECA',false,$1::jsonb) RETURNING id_fuente::text",[json])).rows[0].id_fuente;
      await audit(c,actor,"recursos",id);return {configured:true};
    });
  }
  if(action==="manual"){
    const id=driveId(text(d.url,500)),read=await readLibraryDocument(id,request);
    return transaction(pool,actor,async c=>{
      const rows=await list(c as unknown as pg.Pool);
      const existing=rows.find(r=>r.biblioteca?.kind==="document"&&r.biblioteca.driveId===id||!r.biblioteca&&r.url_drive&&safeDriveId(r.url_drive)===id);
      if(existing)return {id:existing.id_fuente,alreadyRegistered:true};
      const b:LibraryMeta={v:1,kind:"document",driveId:id,status:"BORRADOR",type:"PROCEDIMIENTO_INTERNO",
        hash:read.hash,revision:read.meta.version,lastRead:new Date().toISOString(),mimeType:read.meta.mimeType,revisionLocal:1};
      const r=await c.query("INSERT INTO fuentes(nombre,url_drive,categoria,activo,biblioteca) VALUES($1,$2,'Por definir',false,$3::jsonb) RETURNING id_fuente::text",
        [read.meta.name,`https://drive.google.com/file/d/${id}/view`,JSON.stringify(b)]);
      await audit(c,actor,"borrador",r.rows[0].id_fuente);return {id:r.rows[0].id_fuente,status:"BORRADOR"};
    });
  }
  const id=identifier(d.id),initial=await rowById(pool,id);
  if(action==="sync")return syncRoot(pool,actor,initial,request);
  if(action==="root-disable"){
    if(initial.biblioteca?.kind!=="root")libraryError("LIBRARY_INVALID_FOLDER");
    return transaction(pool,actor,async c=>{
      const root=await rowById(c as unknown as pg.Pool,id);
      await saveMeta(c,root,{...root.biblioteca!,enabled:false});
      for(const r of await list(c as unknown as pg.Pool))if(r.biblioteca?.rootId===id)
        await saveMeta(c,r,{...r.biblioteca,status:"INACTIVO",reason:"Carpeta desactivada por administrador."});
      await audit(c,actor,"carpeta_inactiva",id);return {disabled:true};
    });
  }
  if(initial.biblioteca&&initial.biblioteca.kind!=="document")libraryError("LIBRARY_NOT_FOUND");
  if(action==="deactivate")return transaction(pool,actor,async c=>{
    const r=await rowById(c as unknown as pg.Pool,id);
    const b=r.biblioteca??{v:1,kind:"document",driveId:safeDriveId(r.url_drive)??"",type:"PROCEDIMIENTO_INTERNO"};
    await saveMeta(c,r,{...b,status:"INACTIVO",reason:"Retirada expresa por administrador."});
    await audit(c,actor,"inactiva",id);return {deactivated:true};
  });
  if(!["read","propose","approve"].includes(action))libraryError("LIBRARY_INVALID_ACTION");
  let read;
  try{read=await readLibraryDocument(initial.biblioteca?.driveId||driveId(initial.url_drive),request);}
  catch(e){
    await transaction(pool,actor,async c=>{
      const r=await rowById(c as unknown as pg.Pool,id);
      const b=r.biblioteca??{v:1,kind:"document",driveId:safeDriveId(r.url_drive)??"",type:"PROCEDIMIENTO_INTERNO"};
      await saveMeta(c,r,{...b,status:"INACTIVO",error:"LIBRARY_DRIVE_ACCESS",reason:"Lectura no confirmada; no responder."});
    });throw e;
  }
  return transaction(pool,actor,async c=>{
    const r=await rowById(c as unknown as pg.Pool,id),b=r.biblioteca??{v:1,kind:"document",driveId:read.meta.id,status:"PENDIENTE_REVISION",type:"PROCEDIMIENTO_INTERNO"};
    if((r.biblioteca?.revisionLocal??0)!==(initial.biblioteca?.revisionLocal??0))libraryError("LIBRARY_STALE_REVIEW");
    const changed=b.hash!==read.hash;
    const current:LibraryMeta={...b,hash:read.hash,revision:read.meta.version,mimeType:read.meta.mimeType,
      lastRead:new Date().toISOString(),error:undefined};
    if(action==="read"){
      if((changed||b.error)&&b.status!=="INACTIVO"){current.status="PENDIENTE_REVISION";current.reason="Contenido o permiso cambió; requiere aprobación explícita.";}
      await saveMeta(c,r,current,!changed&&!b.error&&r.activo&&b.status==="APROBADO");
      return {content:read.content,hash:read.hash};
    }
    const type=String(d.tipo);
    if(!["PROCEDIMIENTO_INTERNO","POLITICA/PREGUNTAS_TRABAJADOR"].includes(type))libraryError("LIBRARY_INVALID_TYPE");
    const proposed={categoria:text(d.categoria),tipo:type,version:text(d.version,80),
      issuedOn:dateField(d.issuedOn,true),vigente_desde:dateField(d.vigente_desde),expiresOn:dateField(d.expiresOn,true),
      scope:text(d.scope,1000),fragments:validateFragments(read.content,d.fragments,type)};
    if(proposed.expiresOn&&proposed.expiresOn<proposed.vigente_desde!)libraryError("LIBRARY_INVALID_DATE");
    if(action==="propose"){
      await saveMeta(c,r,{...current,proposal:{...proposed,actor:actor.email,at:new Date().toISOString()},
        status:changed||b.status!=="APROBADO"?"PENDIENTE_REVISION":b.status},!changed&&r.activo&&b.status==="APROBADO");
      await audit(c,actor,"propuesta",id);return {proposed:true};
    }
    if(d.expectedHash!==read.hash||d.confirmed!==true||d.validityVerified!==true||d.contentReviewed!==true)
      libraryError("LIBRARY_EXPLICIT_APPROVAL_REQUIRED");
    if(b.rootId){
      const root=await rowById(c as unknown as pg.Pool,b.rootId);
      if(!root.biblioteca?.enabled)libraryError("LIBRARY_ROOT_DISABLED");
    }
    current.status="APROBADO";current.type=type as LibraryMeta["type"];current.issuedOn=proposed.issuedOn;current.expiresOn=proposed.expiresOn;
    current.proposal=undefined;current.reason=undefined;
    current.approval={actor:actor.email,at:new Date().toISOString(),hash:read.hash,version:proposed.version,
      scope:proposed.scope,fragments:proposed.fragments,validFrom:proposed.vigente_desde!,validUntil:proposed.expiresOn};
    await c.query("UPDATE fuentes SET categoria=$2,version=$3,vigente_desde=$4 WHERE id_fuente=$1",[id,proposed.categoria,proposed.version,proposed.vigente_desde]);
    await saveMeta(c,r,current,true);await audit(c,actor,"aprobada",id);return {approved:true};
  });
}
function safeDriveId(url:string){try{return driveId(url);}catch{return null;}}
async function syncRoot(pool:pg.Pool,actor:Admin,initial:Row,request:DriveRequest){
  if(initial.biblioteca?.kind!=="root"||!initial.biblioteca.enabled)libraryError("LIBRARY_ROOT_DISABLED");
  const root=initial.biblioteca!,started=Date.now();
  let inventory:Awaited<ReturnType<typeof listLibraryTree>>;
  const boundedRequest:DriveRequest=path=>{
    if(Date.now()-started>60000)return Promise.reject(new Error("SYNC_BUDGET"));
    return request(path);
  };
  try{inventory=await listLibraryTree(root.driveId,boundedRequest);}
  catch(e){
    await transaction(pool,actor,async c=>{
      const latest=await rowById(c as unknown as pg.Pool,initial.id_fuente);
      await saveMeta(c,latest,{...latest.biblioteca!,error:"LIBRARY_LIST_UNAVAILABLE"});
      // An incomplete inventory never means deletion, but no source from an
      // unverified root is eligible until a successful review/approval.
      for(const r of await list(c as unknown as pg.Pool))if(r.biblioteca?.rootId===initial.id_fuente)
        await saveMeta(c,r,{...r.biblioteca,status:"PENDIENTE_REVISION",error:"LIBRARY_LIST_UNAVAILABLE"});
    });throw e;
  }
  const reads: {driveId:string;name:string;folder:string;hash?:string;revision?:string;mimeType:string;error?:string}[]=[];
  for(let i=0;i<inventory.files.length;i+=3){
    const chunk=await Promise.all(inventory.files.slice(i,i+3).map(async({file,folder})=>{
      try{const read=await readLibraryDocument(file.id,boundedRequest);return {driveId:file.id,name:file.name,folder,hash:read.hash,revision:read.meta.version,mimeType:file.mimeType};}
      catch{return {driveId:file.id,name:file.name,folder,mimeType:file.mimeType,error:"LIBRARY_READ_UNAVAILABLE"};}
    }));reads.push(...chunk);
  }
  return transaction(pool,actor,async c=>{
    const currentRoot=await rowById(c as unknown as pg.Pool,initial.id_fuente);
    if(!currentRoot.biblioteca?.enabled||currentRoot.biblioteca.revisionLocal!==root.revisionLocal)libraryError("LIBRARY_STALE_REVIEW");
    const rows=await list(c as unknown as pg.Pool);let added=0,changed=0,blocked=0;
    const seen=new Set(reads.map(r=>r.driveId));
    for(const read of reads){
      const r=rows.find(r=>r.biblioteca?.kind==="document"&&r.biblioteca.driveId===read.driveId||!r.biblioteca&&safeDriveId(r.url_drive)===read.driveId);
      if(r?.biblioteca?.rootId&&r.biblioteca.rootId!==initial.id_fuente)continue; // Stable ID, no duplicate/ownership overwrite.
      if(!r){
        const b:LibraryMeta={v:1,kind:"document",driveId:read.driveId,rootId:initial.id_fuente,folder:read.folder,type:"PROCEDIMIENTO_INTERNO",
          status:"BORRADOR",hash:read.hash,revision:read.revision,mimeType:read.mimeType,error:read.error,lastRead:read.hash?new Date().toISOString():undefined,revisionLocal:1};
        await c.query("INSERT INTO fuentes(nombre,url_drive,categoria,activo,biblioteca) VALUES($1,$2,'Por definir',false,$3::jsonb)",
          [read.name,`https://drive.google.com/file/d/${read.driveId}/view`,JSON.stringify(b)]);added++;continue;
      }
      const b=r.biblioteca??{v:1,kind:"document",driveId:read.driveId,type:"PROCEDIMIENTO_INTERNO",status:"PENDIENTE_REVISION"};
      const differs=b.hash!==read.hash||r.nombre!==read.name;
      const inactive=b.status==="INACTIVO";
      const status=inactive?"INACTIVO":read.error?"PENDIENTE_REVISION":differs||b.error?"PENDIENTE_REVISION":b.status;
      const m:LibraryMeta={...b,rootId:initial.id_fuente,folder:read.folder,hash:read.hash??b.hash,revision:read.revision,mimeType:read.mimeType,
        lastRead:read.hash?new Date().toISOString():b.lastRead,error:read.error,status:status as LibraryMeta["status"],
        reason:differs?"Cambió contenido o título; aprobación anterior conservada pero no publicada.":b.reason};
      await saveMeta(c,r,m,!inactive&&!read.error&&!differs&&!b.error&&r.activo&&b.status==="APROBADO");
      await c.query("UPDATE fuentes SET nombre=$2 WHERE id_fuente=$1",[r.id_fuente,read.name]);
      if(differs)changed++;if(read.error)blocked++;
    }
    for(const r of rows)if(r.biblioteca?.rootId===initial.id_fuente&&!seen.has(r.biblioteca.driveId)){
      await saveMeta(c,r,{...r.biblioteca,status:"INACTIVO",reason:"Ya no está disponible en el inventario completo de la carpeta."});blocked++;
    }
    await saveMeta(c,currentRoot,{...currentRoot.biblioteca!,lastSync:new Date().toISOString(),error:undefined});
    await audit(c,actor,"sincronizacion",initial.id_fuente);return {added,changed,blocked,seen:reads.length};
  });
}
