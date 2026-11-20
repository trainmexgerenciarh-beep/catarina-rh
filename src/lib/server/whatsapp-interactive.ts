import type {OutboundMessage} from "./whatsapp-outbound.ts";

type Result={action:string;reply:string;collaboratorStatus?:string};
type Choice={id:string;title:string;description?:string};

function record(value:unknown):value is Record<string,unknown>{
  return typeof value==="object"&&value!==null&&!Array.isArray(value);
}

const selectionText:Record<string,string>={
  yes:"si",no:"no",confirm:"confirmo",correct:"corregir",cancel:"cancelar",
  date:"fecha de pago",topic:"tema",explanation:"explicacion",
  week_last:"viernes pasado",week_before:"viernes antepasado",other_date:"otra fecha",
  partially:"parcialmente"
};

/** Converts only replies carrying Catarina's known IDs; unknown interactive
 * replies use their visible title, then pass through the same business flow. */
export function readInteractiveSelection(message:Record<string,unknown>):string|null{
  if(message.type!=="interactive"||!record(message.interactive))return null;
  const data=message.interactive;
  const selected=record(data.button_reply)?data.button_reply:
    record(data.list_reply)?data.list_reply:null;
  if(!selected||typeof selected.id!=="string"||typeof selected.title!=="string")return null;
  const match=selected.id.match(/^catarina:(\d+|[a-z_]+)$/);
  if(match)return /^\d+$/.test(match[1])?match[1]:selectionText[match[1]]??selected.title;
  return selected.title;
}

function choiceRows(reply:string):{body:string;choices:Choice[]}|null{
  const lines=reply.split("\n");
  const found:{index:number;label:string;line:number}[]=[];
  for(let i=0;i<lines.length;i++){
    const match=lines[i].match(/^\s*(\d+)\.\s+(.+?)\s*$/);
    if(match)found.push({index:Number(match[1]),label:match[2].trim(),line:i});
  }
  if(found.length<2||found.length>10||found.some((row,i)=>row.index!==i+1))return null;
  const body=lines.filter((_,i)=>!found.some(row=>row.line===i)).join("\n").trim()||"Elige una opción.";
  if(body.length>1024)return null;
  const choices=found.map(({index,label})=>{
    const time=label.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})[–-](\d{2}:\d{2})(.*)$/);
    const title=time?`${time[1]}/${time[2]} ${time[4]}-${time[5]}`:label.slice(0,24).trim();
    const description=time?`${time[3]}${time[6]}`.trim().slice(0,72):
      label.length>24?label.slice(0,72).trim():undefined;
    return {id:`catarina:${index}`,title, ...(description?{description}:{})};
  });
  if(choices.some(choice=>!choice.title||choice.title.length>24||(choice.description?.length??0)>72))return null;
  return {body,choices};
}

function controlChoice(action:string,reply:string):{body:string;choices:Choice[]}|null{
  const button=(id:string,title:string):Choice=>({id:`catarina:${id}`,title});
  if(action==="payroll_friday")return {body:reply,choices:[
    button("week_last","Viernes pasado"),button("week_before","Hace 2 semanas"),button("other_date","Otra fecha")
  ]};
  if(action==="payroll_friday_candidate")return {body:reply,choices:[
    button("yes","Sí, ese viernes"),button("no","Elegir otra fecha")
  ]};
  if(action==="payroll_correct")return {body:reply,choices:[
    button("date","Fecha del pago"),button("topic","Tema"),button("explanation","Explicación")
  ]};
  if(action==="payroll_summary"||action==="voice_summary")return {body:reply,choices:[
    button("confirm","Confirmar"),button("correct","Corregir"),button("cancel","Cancelar")
  ]};
  if(["survey_attention","voice_consent","policy_missing","policy_ticket","payroll_ticket_created",
    "payroll_no_booking","offer"].includes(action))return {body:reply,choices:[
    button("yes","Sí"),button("no","No")
  ]};
  if(action==="survey_resolution")return {body:reply,choices:[
    button("yes","Sí"),button("partially","Parcialmente"),button("no","No")
  ]};
  if(action==="survey_rating")return {body:reply,choices:
    Array.from({length:5},(_,i)=>button(String(i+1),String(i+1)))};
  if(action==="remote_intent"||action==="confirmation")return {body:reply,choices:[
    button("confirm","Confirmar"),button("no","No")
  ]};
  return null;
}

/** Turns existing engine replies into a text or a Meta interactive message.
 * The engine remains the source of business rules and choice ordering. */
export function prepareWhatsAppReply(to:string,result:Result,lastInboundAt=Date.now()):OutboundMessage{
  const fixed=controlChoice(result.action,result.reply);
  const numbered=fixed??choiceRows(result.reply);
  if(numbered&&numbered.body.length<=1024){
    if(numbered.choices.length<=3&&numbered.choices.every(choice=>choice.title.length<=20)){
      return {to,kind:"interactive",lastInboundAt,interactive:{
        type:"button",body:numbered.body,buttons:numbered.choices
      }};
    }
    return {to,kind:"interactive",lastInboundAt,interactive:{
      type:"list",body:numbered.body,buttonText:"Ver opciones",rows:numbered.choices
    }};
  }
  return {to,kind:"text",text:result.reply,lastInboundAt};
}
