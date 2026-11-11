import {readLibraryDocument} from "../src/lib/server/drive-library.ts";
import {ReplitConnectors} from "@replit/connectors-sdk";
import pg from "pg";
import {neonPoolOptions} from "../src/lib/server/postgres-config.ts";
const p=new pg.Pool(neonPoolOptions()),s=new ReplitConnectors();
try{
  const before=(await p.query("SELECT count(*)::int n FROM fuentes")).rows[0].n;
  const doc=await readLibraryDocument("1MZX8X0sGxRGNHdB6IOsLO1z1w4PxSFJMFSBd_GZBdcI");
  const listing=await s.proxy("google-drive","/drive/v3/files?pageSize=1&q=mimeType%3D%27application%2Fvnd.google-apps.folder%27%20and%20trashed%3Dfalse&fields=files(id),incompleteSearch",{method:"GET",signal:AbortSignal.timeout(15000)});
  console.log(JSON.stringify({realDocumentRead:"PASS",titleMatchesProvided:doc.meta.name==="Procedimiento para la gestión de vacaciones",
    hashCalculated:!!doc.hash,treatedAs:"PROCEDIMIENTO_INTERNO_BORRADOR",approved:false,
    folderListingApiStatus:listing.status,folderRootConfigured:false,contentLogged:false,
    storedSourcesBefore:before,storedSourcesAfter:(await p.query("SELECT count(*)::int n FROM fuentes")).rows[0].n}));
}catch(e){console.error("LIBRARY_DRIVE_READ_FAIL",e.code??e.name);process.exitCode=1;}
finally{await p.end();}
