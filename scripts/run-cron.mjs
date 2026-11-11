// No scheduler installation and no URL token. This command only prepares rows.
const base=process.env.CATARINA_BASE_URL,secret=process.env.CRON_SECRET;
if(!base||!secret||secret.length<32){console.error("CRON_CONFIGURATION_REQUIRED");process.exitCode=1;}
else{
  try{
    const url=new URL("/api/cron",base);
    if(url.protocol!=="https:"||url.username||url.password)throw new Error();
    const response=await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(60000),
      headers:{"content-type":"application/json",authorization:`Bearer ${secret}`},body:JSON.stringify({task:"prepare"})});
    if(!response.ok)throw new Error();
    const result=await response.json();
    if(result.outbound!=="OFF"||result.committed!==true)throw new Error();
    console.log(JSON.stringify({task:"prepare",committed:true,prepared:result.prepared,outbound:"OFF"}));
  }catch{console.error("CRON_PREPARATION_NOT_CONFIRMED");process.exitCode=1;}
}
