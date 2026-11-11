export async function readJsonObject(request:Request,maxBytes=16_384):Promise<Record<string,unknown>>{
  if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")
    throw new Error("JSON_REQUIRED");
  const reader=request.body?.getReader();if(!reader)throw new Error("JSON_REQUIRED");
  const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;
      if(size>maxBytes){await reader.cancel();throw new Error("INPUT_TOO_LARGE");}chunks.push(r.value);}
    const data=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!data||typeof data!=="object"||Array.isArray(data))throw new Error("INVALID_INPUT");
    return data;
  }finally{reader.releaseLock();}
}
