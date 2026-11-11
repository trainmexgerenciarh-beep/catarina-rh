/** Pure memory fake of the documented atomic Sheets batch/unique metadata IDs.
 * It never uses the connector, credentials or network. */
export function createSheetsFixture(title,{lostAckOnce=false,lateAckOnce=false}={}){
  let exists=false,appendCount=0,late=null;const rows=[],metadata=new Map();
  function apply(requests){
    const ids=new Set(metadata.keys());
    for(const r of requests){
      if(r.createDeveloperMetadata){const id=r.createDeveloperMetadata.developerMetadata.metadataId;
        if(ids.has(id))return false;ids.add(id);}
      if(r.addSheet&&exists)return false;
    }
    for(const r of requests){
      if(r.addSheet)exists=true;
      if(r.createDeveloperMetadata){const m=r.createDeveloperMetadata.developerMetadata;metadata.set(m.metadataId,m);}
      if(r.appendCells){appendCount++;rows.push(...r.appendCells.rows.map(r=>r.values.map(c=>c.userEnteredValue.stringValue)));}
    }return true;
  }
  const proxy=async(path,init={method:"GET"})=>{
    if(init.method==="GET"&&path.includes("?fields="))return Response.json({
      sheets:exists?[{properties:{title,sheetId:1}}]:[],developerMetadata:[...metadata.values()]});
    if(init.method==="GET"&&path.includes("/values/"))return Response.json({values:rows});
    if(path.endsWith(":batchUpdate")){
      const {requests}=JSON.parse(init.body),data=requests.some(r=>r.appendCells);
      if(data&&lateAckOnce){lateAckOnce=false;late=requests;throw new Error("SYNTHETIC_ACK_TIMEOUT_EFFECT_PENDING");}
      if(data&&late){apply(late);late=null;}
      if(!apply(requests))return Response.json({error:"SYNTHETIC_ATOMIC_CONFLICT"},{status:400});
      if(data&&lostAckOnce){lostAckOnce=false;throw new Error("SYNTHETIC_ACK_LOST_AFTER_EFFECT");}
      return Response.json({});
    }
    throw new Error("UNEXPECTED_SYNTHETIC_SHEETS_REQUEST");
  };
  return {proxy,rows,metadata,get appends(){return appendCount;}};
}
