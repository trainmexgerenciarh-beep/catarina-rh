import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import pg from "pg";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
import {previewDirectory,parseDirectoryText,normalizeDirectoryPhone,handleDirectoryImport,readDirectorySheet} from "../src/lib/server/directory-import.ts";
import {OWNER_EMAIL} from "../src/lib/server/admin-users.ts";
import {runAuthorizedCanary,inspectSheetsAccess} from "../src/lib/server/sheets-access.ts";
import {inspectExportDestination} from "../src/lib/server/monthly-export.ts";
let groups=0;const pass=s=>{groups++;console.log(s+": PASS");};
const owner={email:OWNER_EMAIL,role:"gerente"},manager={email:"synthetic@example.invalid",role:"generalista"};
const header=[" número de empleado "," nombre completo ","departamento"," WhatsApp ","puesto"," estatus "];
const matrix=[header,["SYNTH-IMPORT-A","Persona ficticia A","Prueba","+9990000000001","Prueba"," ACTIVO "],
  ["SYNTH-IMPORT-B","Persona ficticia B","Prueba","+9990000000002","Prueba","inactivo"]];
const csv=matrix.map(r=>r.join(",")).join("\r\n");
let p,c,baseline,sequenceBefore;
const snap=async()=>{
  const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  assert.equal(tables.length,16);const out={};
  for(const t of tables){assert.match(t,/^[a-z_]+$/);out[t]=(await c.query(`SELECT count(*)::int n,
    md5(coalesce(string_agg(row_to_json(r)::text,'|' ORDER BY row_to_json(r)::text),'')) hash FROM public.${t} r`)).rows[0];}
  return JSON.stringify(out);
};
try{
  const preview=previewDirectory(parseDirectoryText(csv),[]);
  assert.deepEqual(preview.counts,{altas:2,cambios:0,sinCambios:0,rechazos:0});
  assert(preview.rows.every(r=>r.centro===null));assert.equal(preview.rows[1].activo,false);
  assert.equal(previewDirectory([[...header," Centro de trabajo "],[...matrix[1],"Centro ficticio"]],[]).rows[0].centro,"Centro ficticio");
  assert.equal(normalizeDirectoryPhone("(555) 000-0000"),"525550000000");
  assert.equal(normalizeDirectoryPhone("+52 555 000 0000"),"525550000000");
  for(const bad of ["5215550000000","5.2555e11","abc5550000000","+0000000000","+5550000000000000"])assert.throws(()=>normalizeDirectoryPhone(bad));
  assert.deepEqual(parseDirectoryText('a,b\r\n"x,y","z""w"'),[["a","b"],["x,y",'z"w']]);
  assert.throws(()=>parseDirectoryText('a,b\n"unclosed,x'));
  assert.throws(()=>previewDirectory([["numero de empleado","numero de empleado"],["1","2"]],[]));
  assert.equal(previewDirectory([header,[...matrix[1].slice(0,5),"desconocido"]],[]).counts.rechazos,1);
  pass("CSV/TSV, espacios, números, teléfono/estatus verificables y centro sin inventar");
  const duplicate=previewDirectory([header,matrix[1],matrix[1]],[]);
  assert.equal(duplicate.counts.rechazos,2);
  const known=preview.rows.map(({line,action,reason,originalPhone,originalStatus,...r})=>r);
  assert.equal(previewDirectory(matrix,known).counts.sinCambios,2);
  assert.equal(previewDirectory([header,[matrix[1][0],"Nombre ficticio modificado",...matrix[1].slice(2)]],known).counts.cambios,1);
  assert.equal(previewDirectory([header,["OTHER",...matrix[1].slice(1)]],known).counts.rechazos,1);
  assert.throws(()=>previewDirectory([header,...Array.from({length:201},()=>matrix[1])],[]));
  pass("Duplicados, diferencias bloqueadas, idénticos y límite de lote; sin actualizaciones implícitas");
  await assert.rejects(()=>readDirectorySheet(async()=>new Response("",{status:403})),e=>e.code==="IMPORT_SHEET_PERMISSION");
  assert.deepEqual(await readDirectorySheet(async()=>Response.json({values:matrix})),matrix);
  const noDb={query:async()=>{throw new Error("Must not query");}};
  await assert.rejects(()=>handleDirectoryImport(noDb,manager,{source:"local",action:"preview",text:csv}),e=>e.code==="ACCESS_DENIED");
  pass("Gestor rechazado antes de SQL; lectura Sheets simulada y error de permisos explícito");
  const now=1_800_000_000_000,rows=[],queries=[];
  const fake={query:async(q)=>{queries.push(q);return {rows:[...rows]};},connect:async()=>{throw new Error("No write expected");}};
  const original=process.env.SESSION_SECRET;
  process.env.SESSION_SECRET=randomBytes(32).toString("hex");
  try{
    const v=await handleDirectoryImport(fake,owner,{source:"local",action:"preview",text:csv},{now:()=>now});
    assert(queries.every(q=>q.startsWith("SELECT")));
    for(const body of [
      {token:v.token.slice(0,-1)+"!",text:csv},
      {token:v.token,text:csv+"\nSYNTH-OTHER,Ficticio,Prueba,+9990000000003,Prueba,activo"}
    ])await assert.rejects(()=>handleDirectoryImport(fake,owner,{source:"local",action:"confirm",...body},{now:()=>now}),e=>e.code.startsWith("IMPORT_"));
    await assert.rejects(()=>handleDirectoryImport(fake,owner,{source:"local",action:"confirm",token:v.token,text:csv},{now:()=>now+600000}),e=>e.code==="IMPORT_PREVIEW_EXPIRED");
    rows.push(known[0]);
    await assert.rejects(()=>handleDirectoryImport(fake,owner,{source:"local",action:"confirm",token:v.token,text:csv},{now:()=>now}),e=>e.code==="IMPORT_PREVIEW_EXPIRED");
  }finally{if(original===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=original;}
  pass("Vista previa solo lectura; token ligado a entrada/directorio/actor y caducidad de 10 minutos");
  // Reproduce uncertain COMMIT without actually committing fixtures to Neon.
  let durable=[],failInsert=false,loseAck=false;
  const transactionalMock={
    async query(){return {rows:structuredClone(durable)};},
    async connect(){
      let work;
      return {release(){},async query(q,args){
        if(q==="BEGIN"){work=structuredClone(durable);return {rows:[]};}
        if(q==="COMMIT"){durable=work;if(loseAck)throw new Error("Synthetic lost acknowledgement");return {rows:[]};}
        if(q==="ROLLBACK")return {rows:[]};
        if(q.includes("FROM public.usuarios_rh"))return {rowCount:1,rows:[{}]};
        if(q.includes("FROM public.colaboradores"))return {rows:structuredClone(work)};
        if(q.startsWith("INSERT INTO public.colaboradores")){
          if(failInsert&&work.length===1)throw new Error("Synthetic insert failure");
          const [id_colaborador,nombre,whatsapp,centro,departamento,puesto,activo]=args;
          work.push({id_colaborador,nombre,whatsapp,centro,departamento,puesto,activo});
        }
        return {rows:[]};
      }};
    }
  };
  const draft=await handleDirectoryImport(transactionalMock,owner,{action:"preview",source:"local",text:csv});
  failInsert=true;
  await assert.rejects(()=>handleDirectoryImport(transactionalMock,owner,{action:"confirm",source:"local",text:csv,token:draft.token}),e=>e.code==="IMPORT_NOT_CONFIRMED");
  assert.equal(durable.length,0);
  failInsert=false;loseAck=true;
  await assert.rejects(()=>handleDirectoryImport(transactionalMock,owner,{action:"confirm",source:"local",text:csv,token:draft.token}),e=>e.code==="COMMIT_OUTCOME_UNKNOWN");
  assert.equal(durable.length,2);
  const recovered=await handleDirectoryImport(transactionalMock,owner,{action:"preview",source:"local",text:csv});
  assert.equal(recovered.preview.counts.altas,0);assert.equal(recovered.preview.counts.sinCambios,2);
  await assert.rejects(()=>handleDirectoryImport(transactionalMock,owner,{action:"confirm",source:"local",text:csv,token:draft.token}),e=>e.code==="IMPORT_PREVIEW_EXPIRED");
  pass("Fallo intermedio revierte todo; acuse COMMIT perdido exige relectura sin duplicar (simulado)");
  const marker="PRUEBA CATARINA "+randomBytes(16).toString("hex");
  let cells=[],writes=0,deny=false,foreign=false,lost=false;
  const google=async(connector,path,init)=>{
    if(connector==="google-drive")return Response.json(path.includes("about")?{user:{emailAddress:"synthetic@example.invalid"}}:{capabilities:{canEdit:true}});
    if(path.includes("?fields="))return Response.json({sheets:[{properties:{sheetId:0,title:"Hoja 1"}}]});
    if(init.method==="GET")return Response.json(cells.length?{values:cells}:{});
    writes++;
    if(deny)return new Response("",{status:403});
    const req=JSON.parse(init.body).requests[0].updateCells;
    if(req.start){
      cells=req.rows.map(r=>r.values.map(v=>v.userEnteredValue.stringValue));
      if(foreign)cells[0][0]="FOREIGN CHANGED CELL";
      if(lost)throw new Error("Synthetic ack loss");
    }else cells=[];
    return Response.json({});
  };
  const proof=await runAuthorizedCanary(marker,google);
  assert(proof.cleaned&&proof.writeVerified);assert.equal(writes,2);assert.equal(cells.length,0);
  deny=true;await assert.rejects(()=>runAuthorizedCanary(marker,google));assert.equal(cells.length,0);
  deny=false;lost=true;await assert.rejects(()=>runAuthorizedCanary(marker,google));assert.equal(cells.length,0);
  lost=false;cells=[["EXISTING FIXTURE"]];const n=writes;
  await assert.rejects(()=>runAuthorizedCanary(marker,google),e=>e.code==="CANARY_DESTINATION_NOT_EMPTY");assert.equal(writes,n);
  cells=[];foreign=true;
  await assert.rejects(()=>runAuthorizedCanary(marker,google),e=>e.code==="CANARY_CLEANUP_REQUIRES_REVIEW");
  assert.equal(cells[0][0],"FOREIGN CHANGED CELL"); // Must NOT clear changed data.
  assert.equal((await inspectSheetsAccess(google)).sheetsIdentity,"NOT_EXPOSED_BY_CONNECTOR");
  const priorTarget=process.env.RH_EXPORT_SPREADSHEET_ID;process.env.RH_EXPORT_SPREADSHEET_ID="not-authorized";
  await assert.rejects(()=>inspectExportDestination(async()=>Response.json({})),e=>e.code==="SHEETS_DESTINATION_CONFLICT");
  if(priorTarget===undefined)delete process.env.RH_EXPORT_SPREADSHEET_ID;else process.env.RH_EXPORT_SPREADSHEET_ID=priorTarget;
  pass("Canaria simulada: ida/vuelta, limpieza exacta, permiso denegado, acuse perdido, hoja ajena y destino restringido");

  // Real SQL only inside ONE outer ROLLBACK. Never touches the provided workers.
  p=new pg.Pool(neonPoolOptions());c=await p.connect();baseline=await snap();
  sequenceBefore=(await c.query("SELECT last_value::text FROM pg_sequences WHERE schemaname='public' AND sequencename='auditoria_accesos_id_seq'")).rows[0]?.last_value;
  assert.equal((await c.query("SELECT count(*)::int n FROM usuarios_rh")).rows[0].n,0,"Do not fixture over activated real accounts");
  assert.equal((await c.query("SELECT count(*)::int n FROM colaboradores WHERE id_colaborador LIKE 'SYNTH-IMPORT-%'")).rows[0].n,0);
  await c.query("BEGIN");
  await c.query("INSERT INTO usuarios_rh(email,role) VALUES($1,'gerente')",[OWNER_EMAIL]);
  const pool={query:(...a)=>c.query(...a),connect:async()=>({release(){},query:(q,a)=>c.query(
    q==="BEGIN"?"SAVEPOINT import_case":q==="COMMIT"?"RELEASE SAVEPOINT import_case":q==="ROLLBACK"?"ROLLBACK TO SAVEPOINT import_case":q,a)})};
  const a=await handleDirectoryImport(pool,owner,{action:"preview",source:"local",text:csv});
  const result=await handleDirectoryImport(pool,owner,{action:"confirm",source:"local",text:csv,token:a.token});
  assert.equal(result.inserted,2);assert.equal(result.updated,0);
  const saved=(await c.query("SELECT id_colaborador,centro,activo FROM colaboradores WHERE id_colaborador LIKE 'SYNTH-IMPORT-%' ORDER BY id_colaborador")).rows;
  assert.equal(saved.length,2);assert(saved.every(r=>r.centro===null));assert.equal(saved[1].activo,false);
  await assert.rejects(()=>handleDirectoryImport(pool,owner,{action:"confirm",source:"local",text:csv,token:a.token}),e=>e.code==="IMPORT_PREVIEW_EXPIRED");
  const again=await handleDirectoryImport(pool,owner,{action:"preview",source:"local",text:csv});
  assert.equal(again.preview.counts.sinCambios,2);assert.equal(again.preview.counts.altas,0);
  const changed=csv.replace("Persona ficticia A","Nombre ficticio corregido");
  const b=await handleDirectoryImport(pool,owner,{action:"preview",source:"local",text:changed});
  assert.equal(b.preview.counts.cambios,1);
  await assert.rejects(()=>handleDirectoryImport(pool,owner,{action:"confirm",source:"local",text:changed,token:b.token}),e=>e.code==="IMPORT_NOTHING_TO_INSERT");
  assert.equal((await c.query("SELECT nombre FROM colaboradores WHERE id_colaborador='SYNTH-IMPORT-A'")).rows[0].nombre,"Persona ficticia A");
  pass("SQL Neon real: alta confirmada, centro NULL, replay sin duplicación y ningún sobrescrito");
  await c.query("ROLLBACK");
  assert.equal(await snap(),baseline);
  const sequenceAfter=(await c.query("SELECT last_value::text FROM pg_sequences WHERE schemaname='public' AND sequencename='auditoria_accesos_id_seq'")).rows[0]?.last_value;
  console.log(JSON.stringify({all16FingerprintsEqual:true,auditSequenceBefore:sequenceBefore??"unused",auditSequenceAfter:sequenceAfter??"unused"}));
  pass("ROLLBACK y huellas/conteos de las 16 tablas iguales; catálogo y horarios intactos");
  console.log(`Importador/Sheets: ${groups} grupos PASS; sin COMMIT Neon ni importación del directorio entregado.`);
}catch(e){
  if(c)await c.query("ROLLBACK").catch(()=>{});
  console.error("DIRECTORY_TEST_FAIL",e.code??e.name);process.exitCode=1;
}finally{if(c)c.release();if(p)await p.end();}
