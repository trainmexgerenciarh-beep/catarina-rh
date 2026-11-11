import assert from "node:assert/strict";
import pg from "pg";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
import {OWNER_EMAIL} from "../src/lib/server/admin-users.ts";
import {libraryAction,libraryView} from "../src/lib/server/document-library.ts";
import {groundedAnswer} from "../src/lib/server/institutional-sources.ts";
import {contentHash,validateFragments,folderId} from "../src/lib/server/library-contract.ts";
import {listLibraryTree} from "../src/lib/server/drive-library.ts";
import {getProjectResources} from "../src/lib/server/project-resources.ts";
import {spawnSync} from "node:child_process";
let groups=0;const pass=s=>{groups++;console.log(s+": PASS");};
const owner={email:OWNER_EMAIL,role:"gerente"},manager={email:"synthetic-library@example.invalid",role:"generalista"};
const rootId="syntheticLibraryRoot001",docId="syntheticLibraryDoc001",subId="syntheticLibraryChild01";
const excerpt="Para solicitar vacaciones de prueba, el trabajador puede presentar su solicitud a Recursos Humanos.";
let content=excerpt+"\n\nDetalle interno ficticio restringido a RH. No publicar instrucciones de operación administrativa.";
let revision="1",denied=false,missing=false,listingDenied=false,pages=0;
const request=async path=>{
  if(denied)return new Response("",{status:403});
  if(path.startsWith("/drive/v3/files?")){
    pages++;if(listingDenied)return new Response("",{status:403});
    const q=new URL("https://synthetic.invalid"+path).searchParams;
    if(q.get("q").includes(subId))return Response.json({files:missing?[]:[{id:docId,name:"Documento ficticio",mimeType:"application/vnd.google-apps.document",version:revision}]});
    return Response.json({files:[{id:subId,name:"Subcarpeta ficticia",mimeType:"application/vnd.google-apps.folder"}]});
  }
  if(path.includes("/export?"))return new Response(content);
  const id=path.match(/files\/([^?]+)/)?.[1];
  return Response.json({id,name:id===rootId?"Raíz ficticia":"Documento ficticio",
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
  const inventory=await listLibraryTree(rootId,request);
  assert.equal(inventory.files.length,1);assert.equal(pages,2);assert(inventory.files[0].folder.includes("Subcarpeta"));
  await assert.rejects(()=>listLibraryTree(rootId,async()=>new Response("",{status:403})),e=>e.code==="LIBRARY_DRIVE_ACCESS");
  await assert.rejects(()=>listLibraryTree(rootId,async path=>path.includes("files?")?Response.json({files:[],incompleteSearch:true}):request(path)),e=>e.code==="LIBRARY_LIST_INCOMPLETE");
  pass("Drive simulado: permisos, subdirectorios, listado incompleto y fragmentos exactos; interno completo prohibido");
  baseline=await snapshot();
  seqBefore=(await c.query("SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='public' AND (sequencename LIKE 'fuentes%' OR sequencename LIKE 'auditoria_accesos%') ORDER BY sequencename")).rows;
  assert.equal((await c.query("SELECT count(*)::int n FROM usuarios_rh")).rows[0].n,0,"No fixture over configured accounts");
  assert.equal((await c.query("SELECT count(*)::int n FROM fuentes")).rows[0].n,0,"No fixture over real library");
  await c.query("BEGIN");
  await c.query("INSERT INTO usuarios_rh(email,role) VALUES($1,'gerente'),($2,'generalista')",[owner.email,manager.email]);
  const pool={query:(...a)=>c.query(...a),connect:async()=>({release(){},query:(q,a)=>c.query(
    q==="BEGIN"?"SAVEPOINT library_case":q==="COMMIT"?"RELEASE SAVEPOINT library_case":q==="ROLLBACK"?"ROLLBACK TO SAVEPOINT library_case":q,a)})};
  await assert.rejects(()=>libraryAction(pool,manager,{action:"root-save",url:rootId},request),e=>e.code==="ACCESS_DENIED");
  denied=true;
  await assert.rejects(()=>libraryAction(pool,owner,{action:"root-save",url:rootId},request),e=>e.code==="LIBRARY_DRIVE_ACCESS");
  assert.equal((await libraryView(pool,owner)).roots.length,0);denied=false;
  const root=await libraryAction(pool,owner,{action:"root-save",url:rootId},request);
  const result=await libraryAction(pool,owner,{action:"sync",id:root.id},request);
  assert.equal(result.added,1);
  let view=await libraryView(pool,manager),doc=view.documents[0];
  assert.equal(doc.biblioteca.status,"BORRADOR");assert.equal(doc.activo,false);assert.equal(doc.biblioteca.type,"PROCEDIMIENTO_INTERNO");
  assert(!JSON.stringify(doc).includes(content));
  assert.equal(await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[doc],async()=>content),null);
  assert((await libraryAction(pool,manager,{action:"manual",url:`https://docs.google.com/document/d/${docId}/edit`},request)).alreadyRegistered);
  pass("SQL Neon ROLLBACK: carpeta, alta automática BORRADOR, identidad Drive estable, nunca publicación automática");
  const fields={id:doc.id_fuente,categoria:"Vacaciones",tipo:"PROCEDIMIENTO_INTERNO",version:"FICTICIA-1",
    issuedOn:"2026-01-01",vigente_desde:"2026-01-01",scope:"Solo solicitud de vacaciones de prueba",fragments:[excerpt]};
  await libraryAction(pool,manager,{action:"propose",...fields},request);
  assert.equal((await libraryView(pool,owner)).documents[0].activo,false);
  await assert.rejects(()=>libraryAction(pool,manager,{action:"approve",...fields},request),e=>e.code==="ACCESS_DENIED");
  await assert.rejects(()=>libraryAction(pool,owner,{action:"approve",...fields,expectedHash:contentHash(content)},request),e=>e.code==="LIBRARY_EXPLICIT_APPROVAL_REQUIRED");
  await assert.rejects(()=>libraryAction(pool,owner,{action:"approve",...fields,fragments:[content],expectedHash:contentHash(content),confirmed:true,validityVerified:true,contentReviewed:true},request),e=>e.code==="LIBRARY_INTERNAL_FULL_TEXT_FORBIDDEN");
  await libraryAction(pool,owner,{action:"approve",...fields,expectedHash:contentHash(content),confirmed:true,validityVerified:true,contentReviewed:true},request);
  doc=(await libraryView(pool,manager)).documents[0];
  assert.equal(doc.biblioteca.status,"APROBADO");assert.equal(doc.biblioteca.approval.actor,owner.email);
  const answer=await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[doc],async()=>content);
  assert(answer?.text.includes(excerpt));assert(!answer.text.includes("Detalle interno"));
  assert(!answer.text.includes("/document/")&&!answer.text.includes("/file/"));
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
  pass("Aprobación delimitada/roles; reinicio Node con snapshot ficticio; contradicción, legado y contenido interno fallan seguro");
  const priorHash=doc.biblioteca.approval.hash;
  content+="\n\nContenido adicional ficticio en revisión.";revision="2";
  assert.equal(await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[doc],async()=>content),null);
  await libraryAction(pool,owner,{action:"sync",id:root.id},request);
  doc=(await libraryView(pool,owner)).documents[0];
  assert.equal(doc.biblioteca.status,"PENDIENTE_REVISION");assert.equal(doc.activo,false);
  assert.equal(doc.biblioteca.approval.hash,priorHash);assert.notEqual(doc.biblioteca.hash,priorHash);
  await libraryAction(pool,owner,{action:"approve",...fields,version:"FICTICIA-2",expectedHash:contentHash(content),confirmed:true,validityVerified:true,contentReviewed:true},request);
  doc=(await libraryView({...pool},owner)).documents[0];
  assert.equal(doc.biblioteca.status,"APROBADO");assert.equal(doc.version,"FICTICIA-2");
  const stored=(await c.query("SELECT biblioteca FROM fuentes WHERE id_fuente=$1",[doc.id_fuente])).rows[0].biblioteca;
  assert.deepEqual(JSON.parse(JSON.stringify(stored)),doc.biblioteca);
  pass("Cambio bloquea publicación, conserva aprobación previa separada; nueva revisión explícita y rehidratación sin mapas de proceso");
  denied=true;
  assert.equal(await groundedAnswer("solicitar vacaciones trabajador","Vacaciones",[doc],async()=>{throw new Error("Denied");}),null);
  await assert.rejects(()=>libraryAction(pool,manager,{action:"read",id:doc.id_fuente},request));
  assert.equal((await libraryView(pool,owner)).documents[0].activo,false);
  denied=false;await libraryAction(pool,owner,{action:"approve",...fields,version:"FICTICIA-2",expectedHash:contentHash(content),confirmed:true,validityVerified:true,contentReviewed:true},request);
  listingDenied=true;
  await assert.rejects(()=>libraryAction(pool,owner,{action:"sync",id:root.id},request));
  assert.equal((await libraryView(pool,owner)).documents[0].activo,false);
  listingDenied=false;missing=true;
  await libraryAction(pool,owner,{action:"sync",id:root.id},request);
  assert.equal((await libraryView(pool,owner)).documents[0].biblioteca.status,"INACTIVO");
  missing=false;await libraryAction(pool,owner,{action:"sync",id:root.id},request);
  assert.equal((await libraryView(pool,owner)).documents[0].biblioteca.status,"INACTIVO"); // No auto-reactivation.
  await libraryAction(pool,owner,{action:"root-disable",id:root.id},request);
  await assert.rejects(()=>libraryAction(pool,owner,{action:"approve",...fields,expectedHash:contentHash(content),confirmed:true,validityVerified:true,contentReviewed:true},request),e=>e.code==="LIBRARY_ROOT_DISABLED");
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
}catch(e){await c.query("ROLLBACK").catch(()=>{});console.error("LIBRARY_TEST_FAIL",e.code??e.name);process.exitCode=1;}
finally{c.release();await p.end();}
