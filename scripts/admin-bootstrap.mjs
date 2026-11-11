import {scryptSync,randomBytes,randomUUID}from"node:crypto";
import{createInterface}from"node:readline/promises";
import{Writable}from"node:stream";
import{mkdir,writeFile}from"node:fs/promises";
import{pathToFileURL}from"node:url";
export function createAccount(email,role,password){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!["generalista","gerente"].includes(role)||password.length<12||password.length>256)
    throw new Error("ACCOUNT_INPUT_INVALID");
  const salt=randomBytes(32).toString("hex");
  return {email,role,salt,hash:scryptSync(password,salt,64).toString("hex")};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let rl;
  try{
    if(!process.stdin.isTTY)throw new Error("PRIVATE_INTERACTIVE_TERMINAL_REQUIRED");
    const muted=new Writable({write(_chunk,_encoding,done){done();}});
    rl=createInterface({input:process.stdin,output:muted,terminal:true});
    const ask=async prompt=>{process.stdout.write(prompt+" (entrada oculta): ");const result=await rl.question("");process.stdout.write("\n");return result;};
    const email=(await ask("Correo autorizado")).trim(),role=(await ask("Rol: generalista o gerente")).trim();
    const password=await ask("Contraseña única de al menos 12 caracteres");
    if(password!==await ask("Repetir contraseña"))throw new Error("PASSWORDS_DO_NOT_MATCH");
    const account=createAccount(email,role,password);
    await mkdir("generated-artifacts",{recursive:true});
    const path=`generated-artifacts/private-admin-${randomUUID()}.json`;
    await writeFile(path,JSON.stringify([account],null,2),{mode:0o600,flag:"wx"});
    console.log(`Archivo privado de hash creado: ${path}. Copiar a Secrets únicamente tras autorización y eliminar el archivo después. No se modificó ningún Secret.`);
  }catch(e){console.error(e instanceof Error?e.message:"BOOTSTRAP_FAILED");process.exitCode=1;}
  finally{rl?.close();}
}
