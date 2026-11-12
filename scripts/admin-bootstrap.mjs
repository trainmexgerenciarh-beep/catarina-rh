import {scryptSync,randomBytes,randomUUID}from"node:crypto";
import{createInterface}from"node:readline/promises";
import{Writable}from"node:stream";
import{mkdir,writeFile}from"node:fs/promises";
import{pathToFileURL}from"node:url";
import{INITIAL_MANAGER_EMAIL,OWNER_EMAIL}from"../src/lib/server/admin-users.ts";
export function createAccount(email,role,password){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!["generalista","gerente"].includes(role)||password.length<12||password.length>256)
    throw new Error("ACCOUNT_INPUT_INVALID");
  const salt=randomBytes(32).toString("hex");
  return {email,role,salt,hash:scryptSync(password,salt,64).toString("hex")};
}
export function createInitialAccounts(ownerPassword,managerPassword){
  if(ownerPassword===managerPassword)throw new Error("PASSWORDS_MUST_BE_DIFFERENT");
  return [createAccount(OWNER_EMAIL,"gerente",ownerPassword),createAccount(INITIAL_MANAGER_EMAIL,"generalista",managerPassword)];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let rl;
  try{
    if(!process.stdin.isTTY)throw new Error("PRIVATE_INTERACTIVE_TERMINAL_REQUIRED");
    const muted=new Writable({write(_chunk,_encoding,done){done();}});
    rl=createInterface({input:process.stdin,output:muted,terminal:true});
    const ask=async prompt=>{process.stdout.write(prompt+" (entrada oculta): ");const result=await rl.question("");process.stdout.write("\n");return result;};
    const initial=process.argv.includes("--initial-pair");
    let accounts;
    if(initial){
      const owner=await ask(`Contraseña privada para la cuenta administradora ${OWNER_EMAIL}`);
      if(owner!==await ask("Repetir contraseña de administrador"))throw new Error("PASSWORDS_DO_NOT_MATCH");
      const manager=await ask(`Contraseña privada para la cuenta generalista ${INITIAL_MANAGER_EMAIL}`);
      if(manager!==await ask("Repetir contraseña de generalista"))throw new Error("PASSWORDS_DO_NOT_MATCH");
      accounts=createInitialAccounts(owner,manager);
    }else{
      const email=(await ask("Correo autorizado")).trim().toLowerCase(),role=(await ask("Rol: generalista o gerente")).trim();
      const password=await ask("Contraseña única de al menos 12 caracteres");
      if(password!==await ask("Repetir contraseña"))throw new Error("PASSWORDS_DO_NOT_MATCH");
      accounts=[createAccount(email,role,password)];
    }
    await mkdir("generated-artifacts",{recursive:true});
    const path=`generated-artifacts/private-admin-${randomUUID()}.json`;
    await writeFile(path,JSON.stringify(accounts,null,2),{mode:0o600,flag:"wx"});
    console.log(`Archivo privado de hashes creado: ${path}. Configurar RH_ADMIN_ACCOUNTS solo en Secrets y eliminar el archivo después. No se modificó ningún Secret.`);
  }catch(e){console.error(e instanceof Error?e.message:"BOOTSTRAP_FAILED");process.exitCode=1;}
  finally{rl?.close();}
}
