import {randomUUID} from "node:crypto";
import type pg from "pg";
import {createMemoryTicketRepository,type Ticket} from "./payroll-tickets.ts";
import {createSimulatedAgenda} from "./agenda-simulation.ts";
import {createAgendaReception} from "./agenda-reception.ts";
import {createCompleteReception,type Prepared} from "./complete-reception.ts";
import {commandFingerprint,type AppliedResult,type PersistentAgenda} from "./agenda-persistence-contract.ts";
import {localDate,plusDays} from "./agenda-time.ts";
import type {ActiveService} from "./neon-collaborators.ts";
const catalog:ActiveService[]=[
  ...["Pago semanal","Despensa","Gasolina","Recibo de nómina","Premios de puntualidad y asistencia","Horas extra","Descuentos","Otros"].map((s,i)=>({idServicio:String(i+1),categoria:"Nómina y prestaciones",subcategoria:s})),
  ...["Premios de puntualidad y asistencia","Permisos","Vacaciones","Política de riesgos psicosociales","Adelantos de nómina"].map((s,i)=>({idServicio:String(i+9),categoria:"Políticas y procedimientos",subcategoria:s})),
  ...["Quejas y denuncias","Ideas y mejoras"].map((s,i)=>({idServicio:String(i+14),categoria:"Tu Voz en Trainmex",subcategoria:s}))
];
type Row=Record<string,any>;
export function createDemoStore(){
  const owner="DEMO-COLABORADOR",now=Date.now();
  const seed:Ticket[]=[{id:"1",folio:"SIM-NOM-1",collaboratorId:owner,serviceId:"1",description:"Datos ficticios para revisar un pago semanal.",summary:"Revisar diferencia ficticia de pago semanal",status:"pendiente de cita",closedAt:null,resolvedAt:null,outcome:null,confirmationId:"demo-seed-ticket"}];
  const tickets=createMemoryTicketRepository(seed);
  const agenda=createSimulatedAgenda({findTicket:id=>tickets.snapshot().find(t=>t.id===id),isActivePayrollService:id=>catalog.some(s=>s.idServicio===id)});
  const next=agenda.list({ticketId:"1",collaboratorId:owner,now,date:plusDays(localDate(now),1),days:14})[0];
  if(next)agenda.book({ticketId:"1",collaboratorId:owner,key:"demo-seed-appointment",now,start:next});
  const data:Record<string,Row[]>={
    colaboradores:[{id_colaborador:owner,nombre:"Colaborador de demostración",whatsapp:"000000000000",centro:"Centro demostración",departamento:"Operaciones ficticias",puesto:"Puesto de prueba",activo:true}],
    servicios:catalog.map(s=>({id_servicio:s.idServicio,categoria:s.categoria,subcategoria:s.subcategoria,activo:true})),
    consultas:[{id_consulta:"1",pregunta_resumen:"Ejemplo ficticio de consulta sin documentación",resultado:"documentacion faltante",fecha:new Date(now).toISOString()}],
    fuentes:[],
    voz:[{id_denuncia:"1",categoria:"Ideas y mejoras",descripcion:"Propuesta completamente ficticia para mejorar la señalización. Autorización informativa de contacto RH: No.",recibida_en:new Date(now).toISOString(),estado:"recibida"}],
    encuestas:[],bloqueos:[],
    configuracion:[
      {label:"Entorno",value:"Demostración aislada",detail:"Sin conexión de negocio a Neon ni contacto con personas"},
      {label:"WhatsApp",value:"BLOQUEADO",detail:"No se envían mensajes"},
      {label:"Fuentes",value:"Pendientes",detail:"No hay fuentes institucionales cargadas en esta demostración"},
      {label:"Exportación",value:"Simulación",detail:"No se escribe en Google Sheets"}
    ]
  };
  let state:Record<string,unknown>={},tail=Promise.resolve();
  const seen=new Map<string,{hash:string;result:unknown}>();
  const receipts=new Map<string,{hash:string;result:AppliedResult}>();
  const persistentView=(a:any)=>({id:a.id,ticketId:a.ticketId,start:new Date(a.start).toISOString(),end:new Date(a.end).toISOString(),modality:"REMOTA" as const,status:a.status==="cancelada"?"CANCELADA" as const:"PROGRAMADA" as const});
  const remote:PersistentAgenda={
    mode:"SIMULATION_ONLY",
    async forOwner(o){return agenda.forOwner(o).map(persistentView);},
    async findAppointment(id,ticketId,o){const a=agenda.forOwner(o).find(a=>a.id===id&&a.ticketId===ticketId);return a?persistentView(a):null;},
    async findApplied(id){return receipts.get(id)?.result??null;},
    async listAvailable(input){return agenda.list({ticketId:input.ticketId,collaboratorId:input.collaboratorId,date:input.date,now:Date.now(),days:1}).map(s=>new Date(s).toISOString());},
    async execute(input){
      const hash=commandFingerprint(input),prior=receipts.get(input.eventId);
      if(prior){if(prior.hash!==hash)throw new Error("EVENT_CONFLICT");return prior.result;}
      const base={ticketId:input.ticketId,collaboratorId:input.collaboratorId,key:input.eventId,now:Date.now()};
      const a=input.operation==="RESERVAR"?agenda.book({...base,start:Date.parse(input.start!)}):
        input.operation==="CANCELAR"?agenda.cancel({...base,id:input.appointmentId!}):
        agenda.reschedule({...base,id:input.appointmentId!,start:Date.parse(input.start!)});
      const result:AppliedResult={version:1,operation:input.operation,ticketId:a.ticketId,appointmentId:a.id,modality:"REMOTA",status:a.status==="cancelada"?"CANCELADA":"PROGRAMADA",start:new Date(a.start).toISOString(),end:new Date(a.end).toISOString()};
      receipts.set(input.eventId,{hash,result});return result;
    }
  };
  const classify=async(text:string)=>{
    const n=text.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
    let id:string|null=null;
    if(/queja|denuncia|acoso/.test(n))id="14";else if(/idea|mejora/.test(n))id="15";
    else if(/vacacion/.test(n))id="11";else if(/permiso/.test(n))id="10";
    else if(/premio|puntualidad|asistencia/.test(n))id=/requisito|regla|obtener/.test(n)?"9":"5";
    else if(/despensa/.test(n))id="2";else if(/gasolina/.test(n))id="3";
    else if(/pago|semanal|nomina/.test(n))id="1";
    return {serviceId:id,classification:id?"clasificado" as const:"sin clasificar" as const};
  };
  async function query(sql:string,p:unknown[]):Promise<pg.QueryResult>{
    let rows:Row[]=[];
    if(sql.includes("SELECT 1 FROM public.operaciones_citas"))rows=receipts.has(String(p[0]))?[{exists:1}]:[];
    else if(sql.includes("INSERT INTO public.tickets")){
      const t=await tickets.createConfirmed({collaboratorId:String(p[0]),serviceId:String(p[1]),description:String(p[2]),summary:String(p[2]),confirmationId:String(p[3])});rows=[{id_ticket:t.id}];
    }else if(sql.includes("INSERT INTO public.consultas")){
      data.consultas.unshift({id_consulta:String(data.consultas.length+1),id_colaborador:p[0],id_servicio:p[1],pregunta_resumen:p[2],resultado:sql.includes("documentacion faltante")?"documentacion faltante":"respondida con fuente",fecha:new Date().toISOString(),id_ticket:p[4]});rows=[];
    }else if(sql.includes("INSERT INTO public.denuncias")){
      const id=String(data.voz.length+1);data.voz.unshift({id_denuncia:id,categoria:p[1],descripcion:p[2],estado:"recibida",recibida_en:new Date().toISOString()});rows=[{id_denuncia:id}];
    }else if(sql.includes("UPDATE public.tickets")){await tickets.closeWithoutAppointment(String(p[0]),String(p[1]));}
    else throw new Error("UNSUPPORTED_DEMO_QUERY");
    return {rows,rowCount:rows.length,command:"DEMO",oid:0,fields:[]};
  }
  const extraTickets=new Map<string,Row>(),extraCitas=new Map<string,Row>();
  function read(resource:string):Row[]{
    if(resource==="tickets")return tickets.snapshot().map(t=>({...t,id_ticket:t.id,folio:t.folio,nombre:data.colaboradores[0].nombre,centro:data.colaboradores[0].centro,departamento:data.colaboradores[0].departamento,resumen:t.summary,estado:t.status,creado_en:new Date(now).toISOString(),cerrado_en:t.closedAt,resuelto_en:t.resolvedAt,resultado:t.outcome,...extraTickets.get(t.id)}));
    if(resource==="citas")return agenda.snapshot().map((a:any)=>({id_cita:a.id,id_ticket:a.ticketId,nombre:data.colaboradores[0].nombre,inicio_programado:new Date(a.start).toISOString(),fin_programado:new Date(a.end).toISOString(),modalidad:[...receipts.values()].some(r=>r.result.appointmentId===a.id)?"REMOTA":"PRESENCIAL",estado:a.status==="cancelada"?"CANCELADA":"PROGRAMADA",...extraCitas.get(a.id)}));
    if(resource==="dashboard")return [
      {label:"Colaboradores activos",value:data.colaboradores.filter(r=>r.activo).length,detail:"Solo identidades ficticias"},
      {label:"Tickets abiertos",value:read("tickets").filter(r=>!r.cerrado_en).length,detail:"Datos aislados de demostración"},
      {label:"Citas programadas",value:read("citas").filter(r=>r.estado==="PROGRAMADA").length,detail:"Una agenda compartida"},
      {label:"Faltantes documentales",value:data.consultas.filter(r=>r.resultado==="documentacion faltante").length,detail:"Consultas sin fuente suficiente"},
      {label:"Satisfacción",value:"—",detail:"No hay respuestas suficientes"},
      {label:"Resolución promedio",value:"—",detail:"No se infiere de una cita"}
    ];
    if(!data[resource])throw new Error("NOT_FOUND");return structuredClone(data[resource]);
  }
  async function write(resource:string,action:string,d:Row){
    if(resource==="configuracion")throw new Error("Demostración: no se realizan exportaciones externas.");
    if(resource==="voz")throw new Error("Solo lectura protegida");
    if(resource==="fuentes"&&action==="verify")throw new Error("Demostración sin acceso a documentos reales. Verifica la fuente desde el panel autorizado.");
    if(resource==="tickets"){
      const current=read("tickets").find(r=>r.id_ticket===String(d.id_ticket));
      if(!current||current.cerrado_en||!d.resultado?.trim())throw new Error("Transición no válida");
      extraTickets.set(String(d.id_ticket),{estado:action==="resolve"?"resuelto":"cerrado por RH",resultado:d.resultado,cerrado_en:new Date().toISOString(),resuelto_en:action==="resolve"?new Date().toISOString():null});return;
    }
    if(resource==="citas"){
      const a=read("citas").find(r=>r.id_cita===String(d.id_cita));
      if(!a||Date.parse(a.fin_programado)>Date.now()||!["REALIZADA","NO_ASISTIO"].includes(d.estado))throw new Error("Solo después de finalizar el horario");
      extraCitas.set(String(d.id_cita),{estado:d.estado,observaciones:d.observaciones});return;
    }
    if(resource==="encuestas"&&action==="prepare"){
      for(const a of read("citas").filter(a=>a.estado!=="CANCELADA"&&localDate(Date.parse(a.inicio_programado))<localDate(Date.now()))){
        if(!data.encuestas.some(e=>e.id_cita===a.id_cita))data.encuestas.push({id_encuesta:String(data.encuestas.length+1),id_cita:a.id_cita,enviada_en:null,respondida_en:null});
      }return;
    }
    if(resource==="encuestas"&&action==="respond"){
      const row=data.encuestas.find(e=>e.id_encuesta===String(d.id_encuesta));
      if(!row||row.respondida_en||typeof d.recibio_atencion!=="boolean")throw new Error("Encuesta no disponible");
      if(d.recibio_atencion&&(!Number.isInteger(Number(d.calificacion))||Number(d.calificacion)<1||Number(d.calificacion)>5||!["Sí","Parcialmente","No"].includes(d.resolucion)))throw new Error("Respuesta no válida");
      Object.assign(row,d,{calificacion:d.recibio_atencion?Number(d.calificacion):null,resolucion:d.recibio_atencion?d.resolucion:null,respondida_en:new Date().toISOString()});return;
    }
    const key:Record<string,string>={colaboradores:"id_colaborador",servicios:"id_servicio",bloqueos:"id_bloqueo",fuentes:"id_fuente"};
    const field=key[resource];if(!field)throw new Error("Acción no disponible");
    if(action==="delete"){data[resource]=data[resource].filter(r=>String(r[field])!==String(d[field]));}
    else {
      if(resource==="fuentes"&&!/^https:\/\/(docs|drive)\.google\.com\//.test(d.url_drive??""))throw new Error("URL Drive requerida");
      if(resource==="bloqueos"){
        if(!(d.hora_inicio<d.hora_fin))throw new Error("Horario no válido");
        const {mexicoInstant}=await import("./agenda-time.ts");
        const start=mexicoInstant(d.fecha,d.hora_inicio),end=mexicoInstant(d.fecha,d.hora_fin);
        if(read("citas").some(a=>a.estado==="PROGRAMADA"&&Date.parse(a.inicio_programado)<end&&Date.parse(a.fin_programado)>start))throw new Error("El bloqueo se solapa con una cita");
      }
      const row=data[resource].find(r=>String(r[field])===String(d[field]));
      if(row)Object.assign(row,d);else data[resource].push({...d,[field]:d[field]||randomUUID()});
      if(resource==="bloqueos")agenda.setBlocks(data.bloqueos.map(b=>({fecha:b.fecha,horaInicio:b.hora_inicio,horaFin:b.hora_fin})));
    }
  }
  async function conversation(text:string,id:string,reset=false){
    const run=async()=>{
      if(reset){state={};return {reply:"Conversación reiniciada; los registros de demostración confirmados permanecen.",action:"reset"};}
      const prior=seen.get(id);if(prior){if(prior.hash!==text)throw new Error("EVENT_CONFLICT");return prior.result;}
      const dependencies={lookupIdentity:async()=>({status:"active" as const,id:owner}),listActiveServices:async()=>catalog,classifyService:classify};
      const base=createAgendaReception(dependencies,tickets,agenda,{schedule:()=>()=>{}});
      const prepared:Prepared={classification:await classify(text),answer:null};
      const full=createCompleteReception(dependencies,null as unknown as pg.Pool,prepared,Date.now(),{manager:base,agenda:remote,query});
      try{
        full.importState("000000000000",state);
        const result=await full.handleMessage("000000000000",text,id);
        state=full.exportState("000000000000");seen.set(id,{hash:text,result});
        if(seen.size>1000)seen.delete(seen.keys().next().value!);
        return result;
      }finally{full.dispose();}
    };
    const result=tail.then(run);tail=result.then(()=>{},()=>{});return result;
  }
  return {read,write,conversation,dispose(){}};
}
const stores=new Map<string,{until:number;store:ReturnType<typeof createDemoStore>}>();
export function getDemo(id?:string){
  const now=Date.now();
  for(const [key,s]of stores)if(s.until<=now){s.store.dispose();stores.delete(key);}
  if(id&&stores.has(id)){const s=stores.get(id)!;s.until=now+7200000;return {id,store:s.store};}
  if(stores.size>=100)throw new Error("Demostración ocupada; intenta más tarde");
  id=randomUUID();const store=createDemoStore();stores.set(id,{until:now+7200000,store});return {id,store};
}
