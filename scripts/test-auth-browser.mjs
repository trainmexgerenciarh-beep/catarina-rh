import assert from"node:assert/strict";
import{fork,spawnSync}from"node:child_process";
import{randomBytes}from"node:crypto";
import{mkdtemp,readFile,rm,chmod}from"node:fs/promises";
import{tmpdir}from"node:os";
import{join}from"node:path";
import{createServer}from"node:https";
import{chromium}from"@playwright/test";
import{createAccount}from"./admin-bootstrap.mjs";
import{createDemoStore}from"../src/lib/server/demo-store.ts";
import{OWNER_EMAIL}from"../src/lib/server/admin-users.ts";
import{previewDirectory,parseDirectoryText}from"../src/lib/server/directory-import.ts";
import{contentHash}from"../src/lib/server/library-contract.ts";
if(process.argv.includes("--private-https-child")){
  process.once("message",async config=>{
    try{
      process.env.RH_ADMIN_ACCOUNTS=JSON.stringify(config.accounts);
      process.env.SESSION_SECRET=config.sessionKey;process.env.CRON_SECRET=config.cronKey;
      let handler;
      const server=createServer({key:await readFile(config.keyPath),cert:await readFile(config.certPath)},
        (req,res)=>handler?handler(req,res):res.writeHead(503).end());
      await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
      process.env.ORIGIN=`https://127.0.0.1:${server.address().port}`;
      ({handler}=await import("../build/handler.js"));
      process.send({ready:true,port:server.address().port});
      process.on("message",m=>{
        if(m==="stop"){server.closeAllConnections();server.close(()=>process.exit(0));}
        if(m?.testConfig===true){
          if(m.accounts===null)delete process.env.RH_ADMIN_ACCOUNTS;
          else process.env.RH_ADMIN_ACCOUNTS=JSON.stringify(m.accounts);
          process.send({configUpdated:true});
        }
      });
    }catch{process.send({ready:false});process.exit(1);}
  });
}else{
  let browser,child,dir,stage="bootstrap",groups=0;
  const pass=name=>{groups++;console.log(name+": PASS");};
  const password=randomBytes(24).toString("base64url");
  const accounts=[createAccount("synthetic-manager@example.invalid","gerente",password),
    createAccount("synthetic-generalist@example.invalid","generalista",password)];
  const sessionKey=randomBytes(32).toString("hex"),cronKey=randomBytes(32).toString("hex");
  const stop=async()=>{
    if(!child)return;
    const c=child;child=undefined;
    if(c.exitCode!==null)return;
    c.send("stop");
    await Promise.race([new Promise(r=>c.once("exit",r)),new Promise(r=>setTimeout(()=>{c.kill("SIGKILL");r();},5000).unref())]);
  };
  try{
    dir=await mkdtemp(join(tmpdir(),"catarina-auth-private-"));
    const keyPath=join(dir,"key.pem"),certPath=join(dir,"cert.pem");
    const generated=spawnSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-sha256",
      "-subj","/CN=localhost","-addext","subjectAltName=IP:127.0.0.1,DNS:localhost","-keyout",keyPath,"-out",certPath],{stdio:"ignore"});
    assert.equal(generated.status,0,"Temporary TLS certificate creation failed");
    await chmod(keyPath,0o600);
    const start=async()=>{
      child=fork("scripts/test-auth-browser.mjs",["--private-https-child"],{
        env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:"production",TZ:"UTC"},
        stdio:["ignore","ignore","ignore","ipc"]});
      const ready=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error("PRIVATE_SERVER_TIMEOUT")),30000);
        child.once("message",m=>{clearTimeout(timer);m.ready?resolve(m.port):reject(new Error("PRIVATE_SERVER_FAILED"));});
        child.once("exit",()=>{clearTimeout(timer);reject(new Error("PRIVATE_SERVER_EXITED"));});
      });
      child.send({accounts,sessionKey,cronKey,keyPath,certPath});
      return `https://127.0.0.1:${await ready}`;
    };
    let base=await start();
    browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE??"/repl/tools/bin/chromium",headless:true,args:["--no-sandbox"]});
    const manager=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
    const generalist=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:402,height:874}});
    const anonymous=await browser.newContext({ignoreHTTPSErrors:true});
    const session=async ctx=>(await ctx.request.get(base+"/api/admin/session")).json();
    stage="unauthorized";
    for(const resource of ["dashboard","colaboradores","tickets","citas","fuentes","voz","encuestas"])
      assert.equal((await anonymous.request.get(base+"/api/rh/"+resource)).status(),401);
    assert.equal((await anonymous.request.get(base+"/readyz")).status(),401);
    assert.equal((await anonymous.request.get(base+"/healthz")).status(),200);
    assert.equal((await anonymous.request.post(base+"/api/cron",{data:{task:"prepare"}})).status(),401);
    pass("HTTPS privado: rutas RH/readiness/cron cerradas sin sesión o credencial");
    const loginPage=async(ctx,email)=>{
      const page=await ctx.newPage(),store=createDemoStore();
      store.write("fuentes","save",{nombre:"SYNTHETIC DATE TEST",categoria:"Políticas y procedimientos",
        url_drive:"https://docs.google.com/document/d/synthetic-source-not-real",version:"SYNTHETIC",
        vigente_desde:"2026-01-01",activo:false});
      await page.route("**/api/admin/library",async route=>{
        const docs=store.read("fuentes").filter(r=>r.nombre==="SYNTHETIC DATE TEST").map(r=>({...r,
          biblioteca:{v:1,kind:"document",driveId:"synthetic-source-not-real",status:"BORRADOR",type:"PROCEDIMIENTO_INTERNO"}}));
        return route.fulfill({json:{documents:docs,roots:[],categories:["Vacaciones"],resources:{},principal:email===OWNER_EMAIL}});
      });
      await ctx.route("**/api/rh/*",async route=>{
        // ONLY data is mocked; identity, cookies, login/logout and role gates
        // are the actual production-built server, without DATABASE_URL.
        const auth=await session(ctx);
        if(!auth.authenticated)return route.continue();
        const resource=new URL(route.request().url()).pathname.split("/").at(-1);
        if(auth.role!=="gerente"&&["voz","servicios","fuentes","configuracion"].includes(resource)&&route.request().method()!=="GET")
          return route.continue();
        if(resource==="voz"&&auth.role!=="gerente")return route.continue();
        if(route.request().method()==="GET"){
          const rows=store.read(resource);
          if(resource==="fuentes")for(const row of rows)row.vigente_desde="2026-01-01T00:00:00.000Z";
          return route.fulfill({json:{rows,role:auth.role,mode:"neon"}});
        }
        const body=route.request().postDataJSON();const row=store.write(resource,body.action,body.data);
        return route.fulfill({json:{ok:true,row}});
      });
      await page.goto(base+"/login");
      await page.getByLabel("Correo autorizado").fill(email);await page.getByLabel("Contraseña",{exact:true}).fill(password);
      await page.getByRole("button",{name:/Iniciar sesión/}).click();
      await page.waitForURL("**/panel");await page.getByRole("heading",{name:"Buen día. Aquí está RH."}).waitFor();
      return page;
    };
    stage="browser-login";
    const mg=await loginPage(manager,accounts[0].email),gn=await loginPage(generalist,accounts[1].email);
    assert.equal((await session(manager)).role,"gerente");assert.equal((await session(generalist)).role,"generalista");
    const cookie=(await manager.cookies()).find(c=>c.name==="rh_session");
    assert(cookie.secure&&cookie.httpOnly&&cookie.sameSite==="Strict");
    pass("Login REAL HTTPS/navegador de dos cuentas ficticias: cookies Secure/HttpOnly/Strict y roles distintos");
    stage="roles-and-csrf";
    assert.equal((await generalist.request.get(base+"/api/rh/voz")).status(),403);
    assert.equal((await anonymous.request.get(base+"/api/admin/users")).status(),401);
    assert.equal((await generalist.request.get(base+"/api/admin/users")).status(),403);
    assert.equal((await generalist.request.post(base+"/api/admin/users",{headers:{origin:base},data:{action:"add",email:"synthetic@example.invalid"}})).status(),403);
    assert.equal((await manager.request.get(base+"/api/admin/users")).status(),403);
    assert.equal((await generalist.request.get(base+"/panel?resource=usuarios")).status(),403);
    assert.equal((await anonymous.request.get(base+"/panel?resource=usuarios")).status(),401);
    assert.equal((await anonymous.request.post(base+"/api/admin/directory-import",{headers:{origin:base},data:{action:"preview",source:"sheet"}})).status(),401);
    assert.equal((await generalist.request.post(base+"/api/admin/directory-import",{headers:{origin:base},data:{action:"preview",source:"sheet"}})).status(),403);
    assert.equal((await manager.request.post(base+"/api/admin/directory-import",{headers:{origin:base},data:{action:"preview",source:"sheet"}})).status(),403);
    assert.equal((await generalist.request.get(base+"/panel?resource=importar")).status(),403);
    assert.equal((await anonymous.request.get(base+"/panel?resource=importar")).status(),401);
    assert.equal((await anonymous.request.get(base+"/api/admin/library")).status(),401);
    for(const action of ["approve","root-save","sync","deactivate","resources"])
      assert.equal((await generalist.request.post(base+"/api/admin/library",{headers:{origin:base},data:{action}})).status(),403);
    for(const [resource,action]of [["servicios","save"],["fuentes","save"],["configuracion","export"]])
      assert.equal((await generalist.request.post(base+"/api/rh/"+resource,{headers:{origin:base},data:{action,data:{}}})).status(),403);
    assert.equal((await manager.request.post(base+"/api/admin/logout",{headers:{origin:"https://attacker.invalid"},data:{}})).status(),403);
    assert.equal((await session(manager)).authenticated,true);
    await gn.goto(base+"/panel?resource=fuentes");await gn.locator(".page-heading h1").waitFor();
    assert.equal(await gn.getByRole("button",{name:"Registrar carpeta"}).count(),0);
    await mg.goto(base+"/panel?resource=fuentes");await mg.getByRole("heading",{name:"Biblioteca de documentos"}).waitFor();
    await mg.locator(".document-row").filter({hasText:"SYNTHETIC DATE TEST"}).getByRole("button",{name:"Abrir ficha",exact:true}).click();
    assert.equal(await mg.getByLabel(/Vigente desde.*Obligatoria/).inputValue(),"2026-01-01");
    assert.equal(await mg.getByRole("button",{name:"Aprobar y publicar alcance"}).count(),0);
    await mg.getByRole("button",{name:"Cerrar ficha",exact:true}).click();
    assert(await gn.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    pass("Permisos reales previos a SQL, CSRF rechazado y acciones según rol/móvil");
    stage="logout";
    await mg.getByRole("button",{name:"Cerrar sesión"}).click();await mg.waitForURL("**/login");
    assert.equal((await session(manager)).authenticated,false);assert.equal((await session(generalist)).authenticated,true);
    const copied=await anonymous.request.get(base+"/api/admin/session",{headers:{cookie:`rh_session=${cookie.value}`}});
    assert.equal((await copied.json()).authenticated,false);
    pass("Logout REAL revoca cookie copiada y no termina la sesión del otro perfil");
    stage="restart";
    const surviving=(await generalist.cookies()).find(c=>c.name==="rh_session");
    await stop();base=await start();
    const afterRestart=await anonymous.request.get(base+"/api/admin/session",{headers:{cookie:`rh_session=${surviving.value}`}});
    assert.equal((await afterRestart.json()).authenticated,false);
    assert.equal((await anonymous.request.get(base+"/api/rh/tickets",{headers:{cookie:`rh_session=${surviving.value}`}})).status(),401);
    pass("Reinicio real del proceso SSR: sesión antigua invalidada, sin restauración insegura");
    stage="config-change";
    const setConfig=async list=>{
      const ack=new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error("CONFIG_ACK_TIMEOUT")),5000);
        child.once("message",m=>{clearTimeout(timeout);m.configUpdated?resolve():reject(new Error("CONFIG_ACK_FAILED"));});
      });
      child.send({testConfig:true,accounts:list});await ack;
    };
    const context=await browser.newContext({ignoreHTTPSErrors:true});
    assert.equal((await context.request.post(base+"/api/admin/login",{headers:{origin:base},
      data:{email:accounts[1].email,password}})).status(),200);
    assert.equal((await session(context)).role,"generalista");
    await setConfig([accounts[0],{...accounts[1],role:"gerente"}]);
    assert.equal((await session(context)).authenticated,false);
    assert.equal((await context.request.get(base+"/api/rh/tickets")).status(),401);
    assert.equal((await context.request.post(base+"/api/admin/login",{headers:{origin:base},
      data:{email:accounts[1].email,password}})).status(),200);
    assert.equal((await session(context)).role,"gerente");
    await setConfig(null);
    assert.equal((await session(context)).authenticated,false);
    assert.equal((await context.request.post(base+"/api/admin/login",{headers:{origin:base},
      data:{email:accounts[1].email,password}})).status(),503);
    assert.equal((await context.request.get(base+"/api/rh/voz")).status(),401);
    await context.close();
    pass("HTTPS real: cambio de permisos revoca sesión y ausencia de configuración bloquea login y módulos");
    stage="owner-ui";
    // Isolated child, NO database credentials. Synthetic password in RAM only.
    await setConfig([createAccount(OWNER_EMAIL,"gerente",password)]);
    const owner=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
    const op=await loginPage(owner,OWNER_EMAIL);
    assert.equal((await owner.request.post(base+"/api/admin/users",{headers:{origin:"https://attacker.invalid"},data:{action:"add"}})).status(),403);
    const users=[{email:OWNER_EMAIL,role:"gerente",activo:true,revision:"1"}],audit=[];
    await owner.route("**/api/admin/users",async route=>{
      if(route.request().method()==="GET")return route.fulfill({json:{rows:users,audit}});
      const d=route.request().postDataJSON(),u=users.find(x=>x.email===d.email);
      if(d.action==="add")users.push({email:d.email,role:"generalista",activo:true,revision:"1"});
      else if(d.action==="edit"){u.email=d.newEmail;u.revision=String(+u.revision+1);}
      else{u.activo=d.action==="activate";u.revision=String(+u.revision+1);}
      audit.push({actor:OWNER_EMAIL,accion:d.action,cuenta:d.email,fecha:new Date().toISOString()});
      return route.fulfill({json:{ok:true}});
    });
    await op.getByRole("link",{name:/Usuarios y accesos/}).click();
    await op.getByRole("heading",{name:"Usuarios y accesos",exact:true}).waitFor();
    assert.equal(await op.locator(".account-row").first().getByRole("button").count(),0);
    await op.getByRole("button",{name:"Agregar cuenta",exact:true}).click();
    await op.getByLabel("Correo gestor").fill("fixture-browser@example.invalid");
    await op.getByRole("dialog").getByRole("button",{name:"Agregar cuenta",exact:true}).click();
    const fixture=()=>op.locator(".account-row").filter({hasText:"fixture-browser@example.invalid"});
    await fixture().getByRole("button",{name:"Desactivar",exact:true}).click();
    await op.getByRole("alertdialog").getByRole("button",{name:"Desactivar cuenta",exact:true}).click();
    await fixture().getByRole("button",{name:"Activar",exact:true}).click();
    await op.getByRole("alertdialog").getByRole("button",{name:"Activar cuenta",exact:true}).click();
    await fixture().getByRole("button",{name:"Revocar",exact:true}).click();
    await op.getByRole("alertdialog").getByRole("button",{name:"Revocar acceso",exact:true}).click();
    await fixture().getByRole("button",{name:"Editar correo",exact:true}).click();
    await op.getByLabel(/Correo nuevo/).fill("fixture-renamed@example.invalid");
    await op.getByRole("dialog").getByRole("button",{name:"Guardar correo",exact:true}).click();
    await op.locator(".account-row").filter({hasText:"fixture-renamed@example.invalid"}).waitFor();
    assert.equal(audit.length,5);
    await op.setViewportSize({width:402,height:874});
    assert(await op.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    pass("Usuarios UI escritorio/móvil: cinco acciones con API mock; login/SSR y CSRF HTTPS reales");
    stage="directory-import-ui";
    assert.equal((await owner.request.post(base+"/api/admin/directory-import",{headers:{origin:"https://attacker.invalid"},data:{action:"confirm"}})).status(),403);
    let confirmations=0,previewCalls=0,changed=false;
    const fixtureCsv="número de empleado,nombre completo,departamento,WhatsApp,puesto,estatus\nSYNTH-UI,Persona ficticia UI,Prueba,+9990000000009,Prueba,activo";
    await owner.route("**/api/admin/directory-import",async route=>{
      const d=route.request().postDataJSON();
      if(d.action==="preview"){
        previewCalls++;
        if(d.source==="sheet")return route.fulfill({status:403,json:{error:"Permiso de hoja no disponible en esta prueba; usa CSV privado."}});
        return route.fulfill({json:{preview:previewDirectory(parseDirectoryText(d.text),[]),token:"synthetic-preview-token"}});
      }
      confirmations++;
      if(changed)return route.fulfill({status:400,json:{error:"La vista previa venció. Genera una nueva."}});
      return route.fulfill({json:{inserted:1,updated:0}});
    });
    await op.goto(base+"/panel?resource=importar");
    await op.getByRole("heading",{name:"Importar directorio",exact:true}).waitFor();
    await op.getByRole("button",{name:/Generar vista previa/}).click();
    await op.getByText(/Permiso de hoja no disponible/).waitFor();
    await op.getByRole("button",{name:/Archivo o texto local/i}).click();
    await op.locator("#directory-text").fill(fixtureCsv);
    assert.equal(confirmations,0);
    await op.getByRole("button",{name:/Generar vista previa/}).click();
    await op.getByText("Persona ficticia UI",{exact:true}).waitFor();
    assert(await op.getByText("A DEFINIR (opcional)",{exact:false}).count()>0);
    const confirm=op.getByRole("button",{name:/Confirmar.*alta/i});
    assert(await confirm.isDisabled());
    await op.locator(".confirm-check input").check();
    assert(await confirm.isEnabled());
    await op.locator("#directory-text").fill(fixtureCsv+"\n");
    assert.equal(await op.locator(".confirm-check").count(),0);
    await op.getByRole("button",{name:/Generar vista previa/}).click();
    await op.locator(".confirm-check input").check();changed=true;
    await confirm.click();await op.getByText("La vista previa venció. Genera una nueva.",{exact:true}).waitFor();
    assert.equal(confirmations,1);assert.equal(await op.locator(".confirm-check").count(),0);
    await op.getByRole("button",{name:/Generar vista previa/}).click();
    await op.locator(".confirm-check input").check();changed=false;
    assert(await op.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    await op.setViewportSize({width:1440,height:1000});
    assert(await op.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    await confirm.click();await op.getByRole("heading",{name:"Directorio",exact:true}).waitFor();
    assert.equal(confirmations,2);assert.equal(previewCalls,4);
    pass("Importador UI móvil/escritorio: fallback privado, revisión sin alta, consentimiento, invalidación y error sin falso éxito");
    stage="library-ui";
    await op.unroute("**/api/admin/library");
    const pub="Para solicitar vacaciones de prueba, presenta tu solicitud a Recursos Humanos.";
    let bodyText=pub+"\n\nInstrucciones ficticias restringidas a RH, nunca publicadas.",forbiddenRoot=true,approvals=0;
    const lib={documents:[],roots:[],categories:["Vacaciones"],resources:{directoryId:"syntheticDirectory001",exportId:"syntheticExportSheet01"},principal:true};
    await op.route("**/api/admin/library",async route=>{
      if(route.request().method()==="GET")return route.fulfill({json:lib});
      const d=route.request().postDataJSON();
      if(d.action==="root-save"){
        if(forbiddenRoot)return route.fulfill({status:400,json:{error:"No hay permiso de lectura de carpeta; usa enlace individual.",code:"LIBRARY_DRIVE_ACCESS"}});
        lib.roots=[{id_fuente:"1",nombre:"Raíz ficticia UI",url_drive:d.url,biblioteca:{kind:"root",driveId:"syntheticRootBrowser001",enabled:true}}];
      }
      if(d.action==="sync")lib.documents=[{id_fuente:"2",nombre:"Documento ficticio UI",categoria:"Vacaciones",version:null,vigente_desde:null,
        biblioteca:{v:1,kind:"document",driveId:"syntheticDocBrowser001",rootId:"1",status:"BORRADOR",type:"PROCEDIMIENTO_INTERNO",hash:contentHash(bodyText)}}];
      if(d.action==="read")return route.fulfill({json:{ok:true,content:bodyText,hash:contentHash(bodyText)}});
      if(d.action==="approve"){
        assert.equal(d.expectedHash,contentHash(bodyText));assert.deepEqual(d.fragments,[pub]);assert(d.confirmed&&d.validityVerified&&d.contentReviewed);approvals++;
        Object.assign(lib.documents[0],{version:d.version,vigente_desde:d.vigente_desde,biblioteca:{...lib.documents[0].biblioteca,
          status:"APROBADO",approval:{actor:OWNER_EMAIL,at:new Date().toISOString(),hash:contentHash(bodyText),version:d.version,scope:d.scope,fragments:d.fragments}}});
      }
      if(d.action==="deactivate")lib.documents[0].biblioteca.status="INACTIVO";
      return route.fulfill({json:{ok:true}});
    });
    assert.equal((await owner.request.post(base+"/api/admin/library",{headers:{origin:"https://attacker.invalid"},data:{action:"approve"}})).status(),403);
    await op.goto(base+"/panel?resource=fuentes");
    await op.getByRole("heading",{name:"Biblioteca de documentos"}).waitFor();
    await op.getByRole("button",{name:"Registrar carpeta",exact:true}).first().click();
    stage="library-folder";
    await op.getByLabel("Nombre de referencia",{exact:true}).fill("Raíz ficticia UI");
    await op.getByLabel("Enlace Drive",{exact:true}).fill("https://drive.google.com/drive/folders/syntheticRootBrowser001");
    await op.getByRole("dialog").getByRole("button",{name:/Registrar carpeta|Guardar carpeta/}).click();
    await op.getByText(/No hay permiso de lectura de carpeta/).first().waitFor();
    forbiddenRoot=false;
    await op.getByRole("dialog").getByRole("button",{name:/Registrar carpeta|Guardar carpeta/}).click();
    await op.getByRole("button",{name:/Sincronizar.*Revisar cambios/}).click();
    stage="library-review";
    await op.getByRole("tab",{name:/Por revisar/}).click();
    await op.getByRole("button",{name:"Abrir ficha"}).click();
    const approve=op.getByRole("button",{name:"Aprobar y publicar alcance"});
    assert(await approve.isDisabled());await op.getByRole("button",{name:"Leer en privado"}).click();
    await op.locator(".document-content").waitFor();
    await op.getByLabel(/Categoría.*Obligatoria/).fill("Vacaciones");
    await op.getByLabel(/Versión.*Obligatoria/).fill("SYNTHETIC");
    await op.getByLabel(/Vigente desde.*Obligatoria/).fill("2026-01-01");
    await op.getByLabel(/Alcance/).fill("Solo solicitud ficticia de vacaciones");
    await op.getByLabel(/Fragmentos exactos/).fill(pub);
    stage="library-approval";
    await op.getByLabel(/Revisé el contenido/).check();await op.getByLabel(/Verifiqué documentalmente/).check();await op.getByLabel(/Confirmo publicar/).check();
    assert(await approve.isEnabled(),"Explicit review should enable approval");
    op.once("dialog",d=>d.accept());await approve.click();
    assert.equal(approvals,1);
    stage="library-approved-list";
    await op.getByRole("button",{name:"Cerrar ficha"}).click();
    await op.getByRole("tab",{name:/Aprobados/}).click();
    await op.getByRole("heading",{name:"Documento ficticio UI"}).waitFor();
    await op.setViewportSize({width:402,height:874});assert(await op.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    op.once("dialog",d=>d.accept());await op.locator(".document-row").getByRole("button",{name:"Desactivar",exact:true}).click();
    await op.getByRole("tab",{name:/Inactivos/}).click();await op.getByRole("heading",{name:"Documento ficticio UI"}).waitFor();
    pass("Biblioteca UI HTTPS: carpeta denegada, sincronización, borrador/revisión/aprobación delimitada, retiro y móvil (Drive/datos mock)");
    console.log(`AUTH NAVEGADOR: ${groups} grupos PASS. Login/logout/TLS/roles reales; datos RH mock; proceso privado sin Secrets reales, Neon ni Graph.`);
  }catch(e){
    console.error(`AUTH_TEST_FAILED stage=${stage} kind=${e?.name??"unknown"}`);
    // This stage contains only synthetic fixtures in an isolated HTTPS child.
    if(stage.startsWith("library"))console.error(String(e.message).slice(0,700));
    process.exitCode=1;
  }
  finally{await browser?.close();await stop();if(dir)await rm(dir,{recursive:true,force:true});}
}
