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
      process.on("message",m=>{if(m==="stop"){server.closeAllConnections();server.close(()=>process.exit(0));}});
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
    for(const [resource,action]of [["servicios","save"],["fuentes","save"],["configuracion","export"]])
      assert.equal((await generalist.request.post(base+"/api/rh/"+resource,{headers:{origin:base},data:{action,data:{}}})).status(),403);
    assert.equal((await manager.request.post(base+"/api/admin/logout",{headers:{origin:"https://attacker.invalid"},data:{}})).status(),403);
    assert.equal((await session(manager)).authenticated,true);
    await gn.goto(base+"/panel?resource=fuentes");await gn.locator(".page-heading h1").waitFor();
    assert.equal(await gn.getByRole("button",{name:"Agregar fuente"}).count(),0);
    await mg.goto(base+"/panel?resource=fuentes");await mg.getByRole("button",{name:"Agregar fuente"}).waitFor();
    await mg.getByRole("row").filter({hasText:"SYNTHETIC DATE TEST"}).getByRole("button",{name:"Editar",exact:true}).click();
    assert.equal(await mg.locator("input[type=date]").inputValue(),"2026-01-01");
    await mg.getByRole("dialog").getByRole("button",{name:"Cancelar",exact:true}).click();
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
    console.log(`AUTH NAVEGADOR: ${groups} grupos PASS. Login/logout/TLS/roles reales; datos RH mock; proceso privado sin Secrets reales, Neon ni Graph.`);
  }catch(e){console.error(`AUTH_TEST_FAILED stage=${stage} kind=${e?.name??"unknown"}`);process.exitCode=1;}
  finally{await browser?.close();await stop();if(dir)await rm(dir,{recursive:true,force:true});}
}
