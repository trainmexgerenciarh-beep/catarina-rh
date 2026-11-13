import assert from "node:assert/strict";
import pg from "pg";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
import {OWNER_EMAIL} from "../src/lib/server/admin-users.ts";
import {libraryAction,libraryView} from "../src/lib/server/document-library.ts";
import {groundedAnswer} from "../src/lib/server/institutional-sources.ts";
import {contentHash,validateFragments,splitApprovedDocument,folderId} from "../src/lib/server/library-contract.ts";
import {listLibraryTree} from "../src/lib/server/drive-library.ts";
import {getProjectResources} from "../src/lib/server/project-resources.ts";
import {spawnSync} from "node:child_process";
let groups=0;const pass=s=>{groups++;console.log(s+": PASS");};
const owner={email:OWNER_EMAIL,role:"gerente"},manager={email:"synthetic-library@example.invalid",role:"generalista"};
const rootId="syntheticLibraryRoot001",docId="syntheticLibraryDoc001",subId="syntheticLibraryChild01";
const excerpt="Para solicitar vacaciones de prueba, el trabajador puede presentar su solicitud a Recursos Humanos.";
let content="POLÍTICA FICTICIA · Versión: 01\n\n"+excerpt+"\n\nLa política ficticia también indica conservar el comprobante de la solicitud.";
let revision="1",denied=false,missing=false,listingDenied=false,pages=0;
const request=async path=>{
  if(denied)return new Response("",{status:403});
  if(path.startsWith("/drive/v3/files?")){
    pages++;if(listingDenied)return new Response("",{status:403});
    const q=new URL("https://synthetic.invalid"+path).searchParams;
    if(q.get("q").includes(subId))return Response.json({files:missing?[]:[{id:docId,name:"Política ficticia",mimeType:"application/vnd.google-apps.document",version:revision}]});
    return Response.json({files:[{id:subId,name:"Subcarpeta ficticia",mimeType:"application/vnd.google-apps.folder"}]});
  }
  if(path.includes("/export?"))return new Response(content);
  const id=path.match(/files\/([^?]+)/)?.[1];
  return Response.json({id,name:id===rootId?"Raíz ficticia":id===subId?"Subcarpeta ficticia":"Política ficticia",
    mimeType:[rootId,subId].includes(id)?"application/vnd.google-apps.folder":"application/vnd.google-apps.document",version:revision,modifiedTime:"2026-01-01T00:00:00Z"});
};
const p=new pg.Pool(neonPoolOptions()),c=await p.connect();let baseline,seqBefore;
const snapshot=async()=>{
  const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  assert.equal(tables.length,16);const out={};
  for(const t of tables){assert.match(t,/^[a-z_]+$/);out[t]=(await c.query(`SELECT count(*)::int n,md5(coalesce(string_agg(row_to_json(r)::text,'|' ORDER BY row_to_json(r)::text),'')) hash FROM public.${t} r`)).rows[0];}
  return JSON.stringify(out);
};
try{
  assert.equal(folderId(`https://drive.google.com/drive/folders/${rootId}`),rootId);
  assert.throws(()=>folderId("https://attacker.invalid/folders/notAllowed"));
  assert.throws(()=>validateFragments(content,[content],"PROCEDIMIENTO_INTERNO"),e=>e.code==="LIBRARY_INTERNAL_FULL_TEXT_FORBIDDEN");
  assert.throws(()=>validateFragments(content,["Una regla inventada que no existe."],"PROCEDIMIENTO_INTERNO"),e=>e.code==="LIBRARY_EXCERPT_NOT_EXACT");
  const chunks=splitApprovedDocument(content);
  assert(chunks.length>0&&chunks.every(chunk=>chunk.length<=2500));
  assert.throws(()=>splitApprovedDocument("x".repeat(50001)),e=>e.code==="LIBRARY_DOCUMENT_TOO_LARGE");
  const inventory=await listLibraryTree(rootId,request);
  assert.equal(inventory.files.length,1);assert.equal(pages,2);assert(inventory.files[0].folder.includes("Subcarpeta"));
  await assert.rejects(()=>listLibraryTree(rootId,async()=>new Response("",{status:403})),e=>e.code==="LIBRARY_DRIVE_ACCESS");
  await assert.rejects(()=>listLibraryTree(rootId,async path=>path.includes("files?")?Response.json({files:[],incompleteSearch:true}):request(path)),e=>e.code==="LIBRARY_LIST_INCOMPLETE");
  pass("Drive simulado: permisos/subdirectorios; política en fragmentos acotados; procedimiento interno completo prohibido");
  baseline=await snapshot();
  seqBefore=(await c.query("SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='public' AND (sequencename LIKE 'fuentes%' OR sequencename LIKE 'auditoria_accesos%') ORDER BY sequencename")).rows;
  const rootAccount=(await c.query("SELECT role,activo FROM usuarios_rh WHERE email=$1",[owner.email])).rows[0];
  assert.deepEqual(rootAccount,{role:"gerente",activo:true},"Use the existing owner only for authorization; do not insert or alter the account");
  assert.equal((await c.query("SELECT count(*)::int n FROM usuarios_rh WHERE email=$1",[manager.email])).rows[0].n,0,"Synthetic manager marker must be unused");
  assert.equal((await c.query("SELECT count(*)::int n FROM fuentes WHERE url_drive ILIKE '%syntheticLibrary%'")).rows[0].n,0,"Synthetic Drive markers must be unused");
  await c.query("BEGIN");
  await c.query("INSERT INTO usuarios_rh(email,role) VALUES($1,'generalista')",[manager.email]);
  const pool={query:(...a)=>c.query(...a),connect:async()=>({release(){},query:(q,a)=>c.query(
    q==="BEGIN"?"SAVEPOINT library_case":q==="COMMIT"?"RELEASE SAVEPOINT library_case":q==="ROLLBACK"?"ROLLBACK TO SAVEPOINT library_case":q,a)})};
  const findSynthetic=async actor=>(await libraryView(pool,actor)).documents.find(d=>d.biblioteca.driveId===docId);
  const initialRootCount=(await libraryView(pool,owner)).roots.length;
  assert.equal((await libraryView(pool,owner)).roots.length>=1,true,"The registered institutional root remains visible");
  assert.equal((await libraryView(pool,manager)).suggestedRoot,undefined,"The folder link is shown only to the principal");
  await assert.rejects(()=>libraryAction(pool,manager,{action:"root-save",url:rootId},request),e=>e.code==="ACCESS_DENIED");
  denied=true;
  await assert.rejects(()=>libraryAction(pool,owner,{action:"root-save",url:rootId},request),e=>e.code==="LIBRARY_DRIVE_ACCESS");
  assert.equal((await libraryView(pool,owner)).roots.length,initialRootCount);denied=false;
  const root=await libraryAction(pool,owner,{action:"root-save",url:rootId},request);
  const result=await libraryAction(pool,owner,{action:"sync",id:root.id},request);
  assert.equal(result.added,1);
  let view=await libraryView(pool,manager),doc=view.documents.find(d=>d.biblioteca.driveId===docId);
  assert(doc);assert.equal(doc.biblioteca.status,"BORRADOR");assert.equal(doc.activo,false);assert.equal(doc.biblioteca.type,"POLITICA/PREGUNTAS_TRABAJADOR");
  assert(!JSON.stringify(doc).includes(content));
  assert.equal(await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[doc],async()=>content),null);
  await assert.rejects(()=>libraryAction(pool,manager,{action:"manual",url:`https://docs.google.com/document/d/${docId}/edit`},request),e=>e.code==="ACCESS_DENIED");
  pass("SQL Neon ROLLBACK: raíz preexistente preservada, alta nueva BORRADOR y edición reservada al administrador");
  const fields={id:doc.id_fuente,tipo:"POLITICA/PREGUNTAS_TRABAJADOR",expectedHash:contentHash(content),confirmed:true};
  await assert.rejects(()=>libraryAction(pool,manager,{action:"approve",...fields},request),e=>e.code==="ACCESS_DENIED");
  await assert.rejects(()=>libraryAction(pool,owner,{action:"approve",...fields,expectedHash:"stale"},request),e=>e.code==="LIBRARY_EXPLICIT_APPROVAL_REQUIRED");
  await libraryAction(pool,owner,{action:"approve",...fields},request);
  doc=await findSynthetic(manager);
  assert.equal(doc.biblioteca.status,"APROBADO");assert.equal(doc.biblioteca.approval.actor,owner.email);
  let workerDriveReads=0;
  const answer=await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[doc],async()=>{workerDriveReads++;throw new Error("No per-message Drive request");});
  assert.equal(workerDriveReads,0);
  assert(answer?.text.includes(excerpt));
  assert(!answer.text.includes("/document/")&&!answer.text.includes("/file/"));
  assert.equal(doc.version,"01");
  assert.deepEqual(doc.biblioteca.approval.fragments,splitApprovedDocument(content),"One-click approval stores the complete policy as bounded exact chunks");
  const restarted=spawnSync(process.execPath,["--input-type=module","-e",`
    import {groundedAnswer} from './src/lib/server/institutional-sources.ts';
    let raw='';for await(const chunk of process.stdin)raw+=chunk;
    const {doc,content}=JSON.parse(raw);
    const a=await groundedAnswer('solicitar vacaciones trabajador','Vacaciones',[doc],async()=>content);
    console.log(JSON.stringify({recovered:!!a,restricted:a?.text.includes('Detalle interno')??false}));
  `],{input:JSON.stringify({doc,content}),encoding:"utf8",env:{PATH:process.env.PATH}});
  assert.equal(restarted.status,0);assert.deepEqual(JSON.parse(restarted.stdout),{recovered:true,restricted:false});
  assert.equal(await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[{...doc,biblioteca:undefined}],async()=>content),null);
  const contrary="El trabajador no puede presentar solicitud para vacaciones en esta regla ficticia contradictoria.";
  const other={...doc,id_fuente:"999999",biblioteca:{...doc.biblioteca,hash:contentHash(contrary),
    type:"POLITICA/PREGUNTAS_TRABAJADOR",approval:{...doc.biblioteca.approval,hash:contentHash(contrary),fragments:[contrary]}}};
  assert.equal(await groundedAnswer("solicitud vacaciones trabajador","Vacaciones",[doc,other],async s=>s.id_fuente===doc.id_fuente?content:contrary),null);
  const internal={...doc,activo:true,biblioteca:{...doc.biblioteca,type:"PROCEDIMIENTO_INTERNO",approval:{...doc.biblioteca.approval,fragments:[]}}};
  assert.equal(await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[internal]),null);
  pass("Aprobación de un clic solo para administrador; política guardada completa en fragmentos; procedimiento interno nunca responde");
  const priorHash=doc.biblioteca.approval.hash;
  content+="\n\nContenido adicional ficticio en revisión.";revision="2";
  assert((await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[doc],async()=>content))?.text.includes(excerpt),
    "Only the already approved Neon excerpt is used until the administrator synchronizes the changed source");
  await libraryAction(pool,owner,{action:"sync",id:root.id},request);
   doc=await findSynthetic(owner);
  assert.equal(doc.biblioteca.status,"PENDIENTE_REVISION");assert.equal(doc.activo,false);
  assert.equal(await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[doc]),null);
  assert.equal(doc.biblioteca.approval.hash,priorHash);assert.notEqual(doc.biblioteca.hash,priorHash);
  const changedFields={...fields,expectedHash:contentHash(content)};
  await libraryAction(pool,owner,{action:"approve",...changedFields},request);
  doc=(await libraryView({...pool},owner)).documents.find(d=>d.biblioteca.driveId===docId);
  assert.equal(doc.biblioteca.status,"APROBADO");assert.equal(doc.version,"01");
  const stored=(await c.query("SELECT biblioteca FROM fuentes WHERE id_fuente=$1",[doc.id_fuente])).rows[0].biblioteca;
  assert.deepEqual(JSON.parse(JSON.stringify(stored)),doc.biblioteca);
  pass("Cambio bloquea publicación, conserva aprobación previa separada; nueva revisión explícita y rehidratación sin mapas de proceso");
  denied=true;
  await assert.rejects(()=>libraryAction(pool,manager,{action:"read",id:doc.id_fuente},request));
  const revoked=await findSynthetic(owner);
  assert.equal(revoked.activo,false);
  assert.equal(await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[revoked]),null);
  denied=false;await assert.rejects(()=>libraryAction(pool,owner,{action:"approve",...changedFields},request),e=>e.code==="LIBRARY_DOCUMENT_INACTIVE");
  listingDenied=true;
  await assert.rejects(()=>libraryAction(pool,owner,{action:"sync",id:root.id},request));
  assert.equal((await findSynthetic(owner)).activo,false);
  listingDenied=false;missing=true;
  await libraryAction(pool,owner,{action:"sync",id:root.id},request);
  assert.equal((await findSynthetic(owner)).biblioteca.status,"INACTIVO");
  missing=false;await libraryAction(pool,owner,{action:"sync",id:root.id},request);
  assert.equal((await findSynthetic(owner)).biblioteca.status,"INACTIVO"); // No auto-reactivation.
  await libraryAction(pool,owner,{action:"root-disable",id:root.id},request);
  await assert.rejects(()=>libraryAction(pool,owner,{action:"approve",...changedFields},request),e=>e.code==="LIBRARY_DOCUMENT_INACTIVE");
  pass("Permiso perdido, inventario denegado, retiro, reaparición y carpeta inactiva bloquean sin reactivar fuentes");
  await libraryAction(pool,owner,{action:"resources",directoryUrl:"syntheticDirectorySheet01",exportUrl:"syntheticExportSheet001"},request);
  assert.equal((await getProjectResources(pool)).directoryId,"syntheticDirectorySheet01");
  await assert.rejects(()=>libraryAction(pool,manager,{action:"resources"},request),e=>e.code==="ACCESS_DENIED");
  await c.query("ROLLBACK");
  assert.equal(await snapshot(),baseline);
  const seqAfter=(await c.query("SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='public' AND (sequencename LIKE 'fuentes%' OR sequencename LIKE 'auditoria_accesos%') ORDER BY sequencename")).rows;
  console.log(JSON.stringify({all16FingerprintsEqual:true,sequencesBefore:seqBefore,sequencesAfter:seqAfter}));
  pass("Recursos configurables solo principal y ROLLBACK: las 16 tablas iguales, 15 servicios/5 horarios intactos");
  console.log(`BIBLIOTECA: ${groups} grupos PASS; SQL real solo ROLLBACK, Drive simulado, sin aprobar el documento real.`);
}catch(e){await c.query("ROLLBACK").catch(()=>{});console.error("LIBRARY_TEST_FAIL",e.code??e.name,String(e.message??"").replaceAll(process.cwd()+"/","").slice(0,600));process.exitCode=1;}
finally{c.release();await p.end();}
