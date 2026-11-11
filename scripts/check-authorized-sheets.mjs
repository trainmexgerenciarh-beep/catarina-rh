import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import pg from "pg";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
import {readDirectorySheet,previewDirectory} from "../src/lib/server/directory-import.ts";
import {inspectSheetsAccess,runAuthorizedCanary} from "../src/lib/server/sheets-access.ts";
const canary=process.argv.includes("--authorized-canary");
const p=new pg.Pool(neonPoolOptions());
try{
  // Read actual directory only in RAM; output aggregate validations, never PII.
  const matrix=await readDirectorySheet();
  const existing=(await p.query("SELECT id_colaborador,nombre,whatsapp,centro,departamento,puesto,activo FROM colaboradores ORDER BY id_colaborador")).rows;
  const v=previewDirectory(matrix,existing);
  console.log(JSON.stringify({directoryRead:"PASS",rows:v.rows.length,counts:v.counts,
    missingCenter:v.rows.filter(r=>r.centro==null).length,importExecuted:false,
    rejectionCodes:[...new Set(v.rows.filter(r=>r.action==="RECHAZO").map(r=>r.reason))]}));
  const info=await inspectSheetsAccess();
  console.log(JSON.stringify({destinationRead:"PASS",driveIdentity:info.driveIdentity,driveCanEdit:info.driveCanEdit,
    sheetsIdentity:info.sheetsIdentity,expectedTab:info.expectedTab,writeTest:canary?"AUTHORIZED_SYNTHETIC_ONLY":"NOT_EXECUTED"}));
  if(canary){
    assert(info.expectedTab&&info.driveCanEdit===true);
    const proof=await runAuthorizedCanary("PRUEBA CATARINA "+randomBytes(16).toString("hex"));
    console.log(JSON.stringify({canary:"PASS",...proof}));
  }
}catch(e){console.error("AUTHORIZED_SHEETS_FAIL",e.code??e.name);process.exitCode=1;}
finally{await p.end();}
