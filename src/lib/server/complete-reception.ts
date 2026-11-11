import type pg from "pg";
import {createPersistentReception} from "./persistent-reception.ts";
import {createNeonAgendaRepository} from "./neon-agenda.ts";
import {normalizePayrollInput} from "./payroll-dates.ts";
import {displayAppointment,localDate,plusDays} from "./agenda-time.ts";
import type {ActiveService} from "./neon-collaborators.ts";
import type {Identity} from "./payroll-tickets.ts";
import type {Modality} from "./agenda-persistence-contract.ts";
import {PersistenceError} from "./persistence-unit.ts";
type Classified={serviceId:string|null;classification:"clasificado"|"sin clasificar"};
export type ReceptionDependencies={
  lookupIdentity(phone:string):Promise<Identity>;listActiveServices():Promise<ActiveService[]>;
  classifyService(text:string,services:ActiveService[]):Promise<Classified>;
};
export type Extension={
  category?:"policies"|"voice";phase?:string;serviceId?:string;summary?:string;
  topic?:string;consent?:boolean;ticketId?:string;appointmentId?:string;
  choices?:string[];selected?:string;modality?:Modality;moving?:boolean;
  surveyId?:string;attended?:boolean;rating?:number;resolution?:string;
};
export type Prepared={classification:Classified;answer:{text:string;sourceId:string}|null};
/** Extends existing payroll/menu/agenda, not a second payroll or scheduling engine. */
export function createCompleteReception(deps:ReceptionDependencies,pool:pg.Pool,prepared:Prepared,now=Date.now(),simulation?:{
  manager:ReturnType<typeof createPersistentReception>;
  agenda:ReturnType<typeof createNeonAgendaRepository>;
  query:(sql:string,params:unknown[])=>Promise<pg.QueryResult>;
}) {
  const manager=simulation?.manager??createPersistentReception(deps,pool,{now:()=>now,schedule:()=>()=>{}});
  const agenda=simulation?.agenda??createNeonAgendaRepository(pool,{mode:"SIMULATION_ONLY"});
  let extension:Extension={};
  const reply=(action:string,text:string)=>({collaboratorStatus:"active" as const,classification:null,action,reply:text});
  const query=async(sql:string,params:unknown[])=>{
    if(simulation)return simulation.query(sql,params);
    // All calls execute using the caller's enlisted transaction client.
    const {inAgendaTransaction}=await import("./persistence-unit.ts");
    return inAgendaTransaction(pool,c=>c.query(sql,params));
  };
  const yes=(s:string)=>/^(si|confirmo|si confirmo|correcto|de acuerdo)$/.test(s);
  const nav=(s:string)=>/^(menu(?: principal)?|volver|regresar|cancelar|inicio)$/.test(s);
  async function options(owner:string,date?:string){
    extension.choices=[];
    const first=date??localDate(now);
    for(let i=0;i<14&&extension.choices.length<6;i++)
      extension.choices.push(...await agenda.listAvailable({ticketId:extension.ticketId!,collaboratorId:owner,date:plusDays(first,i),modality:extension.modality??"REMOTA"}));
    extension.choices=extension.choices.slice(0,6);extension.phase="select";
    return reply("remote_options",extension.choices.length?
      `Opciones ${extension.modality==="PRESENCIAL"?"presenciales":"a distancia"} con RH:\n${extension.choices.map((s,i)=>`${i+1}. ${displayAppointment(Date.parse(s))}`).join("\n")}\nElige un número. La atención la realiza RH fuera del chatbot; aún no hay reserva.`
      :"No hay bloques disponibles. Puedes pedir «opciones AAAA-MM-DD» o volver al menú.");
  }
  async function handleMessage(phone:string,text:string,key?:string) {
    const access=await deps.lookupIdentity(phone);
    if(access.status!=="active"||!access.id)return {collaboratorStatus:access.status,classification:null,action:"access_denied",reply:"Este número no está autorizado en el directorio activo de RH."};
    const owner=access.id,s=normalizePayrollInput(text),catalog=await deps.listActiveServices();
    if(nav(s)){extension={};return manager.handleMessage(phone,text,key);}
    if(/^(encuesta|contestar encuesta|responder encuesta)$/.test(s)){
      const row=(await query(`SELECT e.id_encuesta::text FROM public.encuestas e
        JOIN public.citas a USING(id_cita) JOIN public.tickets t USING(id_ticket)
        WHERE t.id_colaborador=$1 AND e.respondida_en IS NULL AND a.estado<>'CANCELADA'
        AND (a.inicio_programado AT TIME ZONE 'America/Mexico_City')::date
          < (clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date
        ORDER BY a.inicio_programado LIMIT 1 FOR UPDATE OF e`,[owner])).rows[0];
      if(!row)return reply("no_survey","No hay una encuesta de cita pendiente a tu nombre.");
      extension={surveyId:row.id_encuesta,phase:"survey-attention"};
      return reply("survey_attention","Respecto a tu cita programada, ¿recibiste atención de RH? Sí/No. Esto es distinto de la resolución del asunto.");
    }
    if(extension.surveyId){
      if(extension.phase==="survey-attention"){
        if(!yes(s)&&s!=="no")return reply("survey_attention","¿Recibiste atención? Responde Sí o No.");
        extension.attended=yes(s);
        extension.phase=extension.attended?"survey-rating":"survey-comment";
        return reply("survey_next",extension.attended?"¿Qué tan satisfecho quedaste con la atención? Indica del 1 al 5.":"Anoté que no recibiste atención; no lo interpretaré como «no resuelto». Puedes añadir un comentario o escribir «sin comentario».");
      }
      if(extension.phase==="survey-rating"){
        if(!/^[1-5]$/.test(s))return reply("survey_rating","Indica una calificación del 1 al 5.");
        extension.rating=Number(s);extension.phase="survey-resolution";
        return reply("survey_resolution","¿Se resolvió tu asunto? Sí / Parcialmente / No.");
      }
      if(extension.phase==="survey-resolution"){
        if(!yes(s)&&!["parcialmente","no"].includes(s))return reply("survey_resolution","Indica Sí, Parcialmente o No.");
        extension.resolution=yes(s)?"Sí":s==="no"?"No":"Parcialmente";extension.phase="survey-comment";
        return reply("survey_comment","Puedes añadir un comentario breve o escribir «sin comentario».");
      }
      await query(`UPDATE public.encuestas e SET recibio_atencion=$2,calificacion=$3,resolucion=$4,comentario=$5,
        respondida_en=clock_timestamp() WHERE e.id_encuesta=$1 AND respondida_en IS NULL AND EXISTS(
          SELECT 1 FROM public.citas a JOIN public.tickets t USING(id_ticket)
          WHERE a.id_cita=e.id_cita AND t.id_colaborador=$6)`,
        [extension.surveyId,extension.attended,extension.attended?extension.rating:null,
          extension.attended?extension.resolution:null,s==="sin comentario"?null:text.slice(0,1000),owner]);
      extension={};return reply("survey_recorded","Gracias. Registré tu respuesta separando atención recibida y resolución. No cambié el estado del ticket por la encuesta.");
    }
    if(/^(?:corregir|me equivoque|corrijo)/.test(s)&&extension.category){
      delete extension.summary;extension.phase="explain";
      return reply("correction","Cuéntame la explicación corregida. No registraré nada hasta confirmar el nuevo resumen.");
    }
    // Remote appointments use the SAME SQL adapter and global resource as payroll.
    if(/^(consultar|ver|mi|mis) citas?$/.test(s)){
      const rows=await agenda.forOwner(owner);
      return reply("agenda_query",rows.length?rows.map(a=>`Cita ${a.id}: ${displayAppointment(Date.parse(a.start))}, ${a.modality}, ticket RH-${a.ticketId}.`).join("\n"):"No hay citas programadas a tu nombre.");
    }
    if(/^(cancelar|reprogramar)(?: (?:la|mi))? cita(?: \d+)?$/.test(s)){
      const rows=await agenda.forOwner(owner);
      const n=s.match(/\d+$/)?.[0],chosen=n?rows.find(r=>r.id===n):rows.length===1?rows[0]:null;
      if(chosen){
        extension={category:"policies",phase:s.startsWith("cancelar")?"cancel":"move",ticketId:chosen.ticketId,appointmentId:chosen.id,modality:chosen.modality};
        return reply("remote_intent",`¿Confirmas ${s.startsWith("cancelar")?"cancelar":"reprogramar"} la cita ${displayAppointment(Date.parse(chosen.start))}? Responde «confirmo» o «no». El ticket no se marca resuelto.`);
      }
      if(rows.length>1&&!chosen)return reply("agenda_choose",rows.map(a=>`Cita ${a.id}: ${displayAppointment(Date.parse(a.start))}, ${a.modality}.`).join("\n")+"\nIndica «cancelar cita ID» o «reprogramar cita ID».");
    }
    if(extension.ticketId){
      if(/^(sin cita|no (quiero|deseo) agendar(?: una cita)?)$/.test(s)){
        const changed=await query(`UPDATE public.tickets SET estado='cerrado sin cita',cerrado_en=clock_timestamp(),
          resultado='No resuelto. Negativa expresa a agendar.' WHERE id_ticket=$1 AND id_colaborador=$2
          AND estado='pendiente de cita' AND resuelto_en IS NULL AND cerrado_en IS NULL
          AND NOT EXISTS(SELECT 1 FROM public.citas WHERE id_ticket=$1 AND estado<>'CANCELADA') RETURNING id_ticket`,
          [extension.ticketId,owner]);
        if(changed.rowCount){extension={};return reply("closed_without_appointment","Cerrado sin cita por negativa expresa; el asunto NO está resuelto.");}
        return reply("close_not_applied","No cerré el ticket: conserva una cita o ya cambió de estado. Puedes consultar cita.");
      }
      if(extension.phase==="cancel"||extension.phase==="move"){
        if(s==="no"){extension.phase="done";return reply("unchanged","Conservé la cita sin cambios.");}
        if(!yes(s))return reply("confirmation","¿Confirmas el cambio? Responde «confirmo» o «no».");
        if(extension.phase==="move"){extension.moving=true;return options(owner);}
        await agenda.execute({eventId:key!,collaboratorId:owner,ticketId:extension.ticketId,appointmentId:extension.appointmentId,operation:"CANCELAR",modality:extension.modality??"REMOTA",confirmed:true});
        extension.phase="done";return reply("remote_cancelled","Cita cancelada. El ticket permanece sin resolver.");
      }
      if(extension.phase==="booking"){
        if(!yes(s))return s==="no"?options(owner):reply("confirmation","¿Confirmas la reserva? Puedes confirmar o elegir otra opción.");
        const a=await agenda.execute({eventId:key!,collaboratorId:owner,ticketId:extension.ticketId,
          ...(extension.moving?{appointmentId:extension.appointmentId}:{}),operation:extension.moving?"REPROGRAMAR":"RESERVAR",
          start:extension.selected,modality:extension.modality??"REMOTA",confirmed:true});
        extension.phase="done";extension.appointmentId=a.appointmentId;delete extension.choices;delete extension.selected;delete extension.moving;
        return reply("remote_registered",`Cita ${a.modality==="PRESENCIAL"?"presencial":"a distancia"} registrada: ${displayAppointment(Date.parse(a.start))}. Ticket RH-${a.ticketId}. RH realizará la atención fuera del chatbot. El asunto no se marca resuelto.`);
      }
      if(extension.phase==="select"){
        if(/^opciones/.test(s))return options(owner,s.match(/\d{4}-\d{2}-\d{2}/)?.[0]);
        const choice=extension.choices?.[Number(s)-1];
        if(!choice)return reply("selection","Elige un número de las opciones o pide «opciones AAAA-MM-DD».");
        extension.selected=choice;extension.phase="booking";
        return reply("confirmation",`¿Confirmas ${displayAppointment(Date.parse(choice))}, ${extension.modality==="PRESENCIAL"?"presencial":"a distancia"}? Volveré a comprobar disponibilidad.`);
      }
      if(extension.phase==="offer"){
        if(yes(s)||/^(agendar|agendar cita)$/.test(s))return options(owner);
        if(/^(no|sin cita|no (quiero|deseo) agendar)$/.test(s)){
          await query(`UPDATE public.tickets SET estado='cerrado sin cita',cerrado_en=clock_timestamp(),
            resultado='No resuelto. Negativa expresa a agendar.' WHERE id_ticket=$1 AND id_colaborador=$2
            AND resuelto_en IS NULL AND NOT EXISTS(SELECT 1 FROM public.citas WHERE id_ticket=$1 AND estado<>'CANCELADA')`,
            [extension.ticketId,owner]);extension.phase="done";
          return reply("closed_without_appointment","Cerrado sin cita por tu negativa expresa; el asunto NO está resuelto.");
        }
        return reply("offer","¿Deseas agendar una cita a distancia con RH? No interpretaré silencio o cambio de menú como rechazo.");
      }
      if(extension.phase==="done")return reply("completed","La operación terminó; no modifiqué el ticket como resuelto. Puedes consultar cita, cancelar/reprogramar cita, volver al menú o expresar que no deseas agendar.");
    }
    if(!extension.category) {
      const menu=manager.exportState(phone).menu as {category?:string;screen?:string}|null;
      const selected=prepared.classification.serviceId?catalog.find(r=>r.idServicio===prepared.classification.serviceId):null;
      if(s==="2"&&(!menu?.category||menu.screen==="main_menu")||selected?.categoria==="Políticas y procedimientos"||s.includes("necesito atencion de rh")){
        extension={category:"policies",phase:"explain",serviceId:selected?.idServicio};
        if(selected&&text.length>20){extension.summary=text.slice(0,1000);}
        else return reply("policies","Puedo orientarte sobre vacaciones, permisos, premios y procedimientos usando solo fuentes autorizadas. ¿Qué necesitas saber?");
      }else if(s==="3"&&(!menu?.category||menu.screen==="main_menu")||selected?.categoria==="Tu Voz en Trainmex"){
        extension={category:"voice",phase:"topic",serviceId:selected?.idServicio};
        if(selected){extension.topic=selected.subcategoria??undefined;extension.phase="explain";}
        if(selected&&text.length>35){extension.summary=text.slice(0,2000);extension.phase="summary";}
        else return reply("voice_submenu",extension.topic?"Cuéntame lo que deseas comunicar, con los detalles necesarios. No investigamos ni prometemos anonimato en este canal identificado.":"Tu Voz en Trainmex:\n1. Quejas y denuncias\n2. Ideas y mejoras\nElige una opción. La autorización de contacto no generará cita ni seguimiento obligatorio.");
      }else return manager.handleMessage(phone,text,key);
    }
    if(extension.category==="policies"){
      if(extension.phase==="summary"){
        if(!yes(s))return reply("confirmation","¿Confirmas registrar este resumen? Puedes corregir o cancelar.");
        const service=catalog.find(x=>x.idServicio===extension.serviceId&&x.categoria==="Políticas y procedimientos");
        if(!service)throw new PersistenceError("INACTIVE_IDENTITY_OR_SERVICE");
        const prior=await query("SELECT 1 FROM public.operaciones_citas WHERE id_evento_meta=$1",[key]);
        if(prior.rowCount)throw new PersistenceError("EVENT_CONFLICT");
        const t=(await query(`INSERT INTO public.tickets(id_colaborador,id_servicio,descripcion,resumen,estado,id_mensaje_confirmacion)
          VALUES($1,$2,$3,$3,'pendiente de cita',$4) RETURNING id_ticket::text`,
          [owner,service.idServicio,extension.summary,key])).rows[0];
        await query(`INSERT INTO public.consultas(id_colaborador,id_servicio,pregunta_resumen,resultado,contexto,id_ticket)
          VALUES($1,$2,$3,'documentacion faltante',$4::jsonb,$5)`,
          [owner,service.idServicio,extension.summary,JSON.stringify({version:1,faltante_documental:true}),t.id_ticket]);
        extension.ticketId=t.id_ticket;delete extension.summary;extension.phase="offer";
        return reply("policy_ticket",`Registré tu consulta y el faltante documental. Folio RH-${t.id_ticket}. ¿Deseas agendar una cita a distancia con RH? Aún no hay reserva.`);
      }
      const service=catalog.find(x=>x.idServicio===(extension.serviceId??prepared.classification.serviceId)&&x.categoria==="Políticas y procedimientos");
      if(!service){
        const policies=catalog.filter(x=>x.categoria==="Políticas y procedimientos");
        const chosen=policies[Number(s)-1];
        if(chosen){extension.serviceId=chosen.idServicio;return reply("question","¿Qué necesitas saber de "+chosen.subcategoria+"?");}
        return reply("policy_topic",`¿Sobre qué tema?\n${policies.map((x,i)=>`${i+1}. ${x.subcategoria}`).join("\n")}`);
      }
      extension.serviceId=service.idServicio;extension.summary=extension.summary??text.slice(0,1000);
      if(prepared.answer&&!s.includes("necesito atencion de rh")){
        await query(`INSERT INTO public.consultas(id_colaborador,id_servicio,pregunta_resumen,resultado,contexto)
          VALUES($1,$2,$3,'respondida con fuente',$4::jsonb)`,
          [owner,service.idServicio,extension.summary,JSON.stringify({version:1,id_fuente:prepared.answer.sourceId})]);
        delete extension.summary;extension.phase="done";
        return reply("policy_answer",prepared.answer.text);
      }
      extension.phase="summary";
      return reply("policy_missing",`No dispongo de una fuente institucional suficiente para responder sin inventar políticas.\nResumen: ${extension.summary}\n¿Confirmas registrar esta consulta para atención de RH y señalar la documentación faltante?`);
    }
    if(extension.phase==="topic"){
      const options=catalog.filter(x=>x.categoria==="Tu Voz en Trainmex");
      const chosen=options.find(x=>/queja|denuncia/.test(s)?/queja|denuncia/i.test(x.subcategoria??""):/idea|mejora/.test(s)?/idea|mejora/i.test(x.subcategoria??""):false)??options[Number(s)-1];
      if(!chosen)return reply("voice_topic","Elige «Quejas y denuncias» o «Ideas y mejoras».");
      extension.serviceId=chosen.idServicio;extension.topic=chosen.subcategoria??"";extension.phase="explain";
      return reply("voice_explain","Cuéntame lo ocurrido o tu propuesta con detalles suficientes. No prometo anonimato ni investigo o resuelvo automáticamente.");
    }
    if(extension.phase==="explain"){
      if(text.length<20||text.length>2000)return reply("voice_detail","Cuéntame con algo más de detalle (hasta 2000 caracteres), sin contraseñas ni datos sensibles innecesarios.");
      extension.summary=text;extension.phase="summary";
    }
    if(extension.phase==="summary"){
      if(!yes(s))return reply("voice_summary",`Resumen de ${extension.topic}:\n${extension.summary}\n¿Confirmas que registre este relato? Puedes corregir o cancelar.`);
      extension.phase="consent";return reply("voice_consent","¿Autorizas que personal de RH te contacte posteriormente? Sí/No. Es solo una anotación informativa; no genera una cita ni seguimiento en la herramienta.");
    }
    if(extension.phase==="consent"){
      if(!yes(s)&&s!=="no")return reply("voice_consent","Indica Sí o No para anotar tu autorización de contacto.");
      const service=catalog.find(x=>x.idServicio===extension.serviceId&&x.categoria==="Tu Voz en Trainmex");
      if(!service)throw new PersistenceError("INACTIVE_IDENTITY_OR_SERVICE");
      const consent=yes(s);
      const r=(await query(`INSERT INTO public.denuncias(id_colaborador,categoria,descripcion,estado)
        VALUES($1,$2,$3,'recibida') RETURNING id_denuncia::text`,
        [owner,service.subcategoria,`${extension.summary}\nAutorización informativa de contacto RH: ${consent?"Sí":"No"}.`])).rows[0];
      extension={category:"voice",phase:"done"};
      return reply("voice_registered",`Recibido con folio VOZ-${r.id_denuncia}. No se generaron citas ni seguimiento automático. RH revisará lo comunicado; este registro no implica investigación ni resolución.`);
    }
    return reply("completed","La recepción terminó. Puedes regresar al menú principal para otra solicitud.");
  }
  return {
    handleMessage,
    exportState(phone:string){return {...manager.exportState(phone),recepcion:structuredClone(extension)};},
    importState(phone:string,state:Record<string,unknown>){manager.importState(phone,state);extension=structuredClone(state.recepcion??{}) as Extension;},
    dispose:()=>manager.dispose()
  };
}
