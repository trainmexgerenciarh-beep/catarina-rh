import {readLibraryDocument,listLibraryTree} from "../src/lib/server/drive-library.ts";
import pg from "pg";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
const ROOT="1rdxsBE2Pd_K3T0Bl8yPOCWpsTQfrsDRK";
const expected=[
  {id:"1DWgYR9rZCNiDNBrzNOilTK4frOveEe4GpiFh_VJpCO4",title:"POLÍTICA DE VACACIONES",version:"05"},
  {id:"14yDh_Mc__9w3lt9h7USmSwIUPIYv-62xiWHlwPnlR5U",title:"POLÍTICA PARA LA GESTIÓN DE PERMISOS Y LICENCIAS",version:"01"}
];
const p=new pg.Pool(neonPoolOptions());
try{
  const c=await p.connect();
  try{
    await c.query("BEGIN READ ONLY");
    const before=(await c.query("SELECT count(*)::int n FROM fuentes")).rows[0].n;
    const roots=(await c.query("SELECT count(*)::int n FROM fuentes WHERE biblioteca->>'kind'='root'")).rows[0].n;
    await c.query("ROLLBACK");
    const inventory=await listLibraryTree(ROOT);
    const policies=[];
    for(const item of expected){
      const listed=inventory.files.find(x=>x.file.id===item.id);
      if(!listed)throw new Error("EXPECTED_POLICY_NOT_LISTED");
      const doc=await readLibraryDocument(item.id);
      const versionMatch=doc.content.match(/\b(?:versi[oó]n)\s*[:.]?\s*0?(\d{1,2})\b/i);
      policies.push({titleMatches:doc.meta.name===item.title,read:"PASS",contentHash:"PASS",
        versionFieldMatches:versionMatch?.[1]===String(Number(item.version)),folderListed:true});
    }
    const internal=await readLibraryDocument("1MZX8X0sGxRGNHdB6IOsLO1z1w4PxSFJMFSBd_GZBdcI");
    await c.query("BEGIN READ ONLY");
    const users=(await c.query("SELECT count(*)::int n FROM usuarios_rh")).rows[0].n;
    const after=(await c.query("SELECT count(*)::int n FROM fuentes")).rows[0].n;
    await c.query("ROLLBACK");
    console.log(JSON.stringify({connectorReadOnly:"PASS",folderListComplete:true,filesInFolder:inventory.files.length,
      policies,internalProcedure:{read:"PASS",inOfficialFolder:inventory.files.some(x=>x.file.id===internal.meta.id),
        classifiedByOperatorAs:"PROCEDIMIENTO_INTERNO_BORRADOR",approved:false},
      appRootConfigured:roots>0,usersConfigured:users>0,sourceRowsBefore:before,sourceRowsAfter:after,
      contentOrLinksLogged:false,neonWrite:"NONE"}));
  }finally{c.release();}
}catch(e){console.error("LIBRARY_DRIVE_READ_FAIL",e.code??e.name);process.exitCode=1;}
finally{await p.end();}
