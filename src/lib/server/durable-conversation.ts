import type pg from "pg";
import {createHash,randomUUID} from "node:crypto";
import {inAgendaTransaction,withTransactionClient,PersistenceError,requireEventId} from "./persistence-unit.ts";
import {createCompleteReception,type ReceptionDependencies,type Extension} from "./complete-reception.ts";
import {groundedAnswer} from "./institutional-sources.ts";

const TTL=120*60*1000,LEASE_MS=90_000;
const digest=(owner:string,text:string)=>createHash("sha256").update(JSON.stringify([1,"whatsapp",owner,"text",text])).digest("hex");
type ContextRow={estado:Record<string,unknown>;revision:string;lease_generacion:string;expires:Date;now:Date};
const deny=(status:"inactive"|"not_found"|"ambiguous")=>({collaboratorStatus:status,classification:null,action:"access_denied",reply:"Este número no está autorizado en el directorio activo de RH."});
/** Two short transactions with lease/fencing. AI/Drive occur ONLY between them.
 * Final context, business effects and incoming receipt share one PostgreSQL client.
 */
export function createDurableConversation(deps:ReceptionDependencies,pool:pg.Pool) {
  async function handleMessage(phone:string,text:string,eventId?:string,unsupported?:{type:string;hash:string}) {
    requireEventId(eventId!);
    if(!text.trim()||text.length>4096)throw new PersistenceError("INVALID_MESSAGE");
    const identity=await deps.lookupIdentity(phone);
    if(identity.status!=="active"||!identity.id)return deny(identity.status==="active"?"ambiguous":identity.status);
    const owner=identity.id,key=eventId!,hash=digest(owner,unsupported?JSON.stringify(["unsupported",unsupported.type,unsupported.hash]):text),token=randomUUID();
    const assertIdentity=async(c:pg.PoolClient)=>{
      const checked=await c.query<{id_colaborador:string;activo:boolean}>(
        `SELECT id_colaborador,activo FROM public.colaboradores
         WHERE regexp_replace(COALESCE(whatsapp,''),'[^0-9]','','g')=$1 LIMIT 2 FOR SHARE`,
        [phone.replace(/\D/g,"")]);
      if(checked.rows.length!==1||checked.rows[0].id_colaborador!==owner||checked.rows[0].activo!==true)
        throw new PersistenceError("ACCESS_DENIED");
    };
    const claim=await inAgendaTransaction(pool,async c=>{
      await assertIdentity(c);
      const prior=(await c.query(`SELECT id_colaborador,huella_entrada,estado_tecnico,resultado_minimo,primera_recepcion_en
        FROM public.eventos_entrantes WHERE id_evento_meta=$1 FOR UPDATE`,[key])).rows[0];
      if(prior&&(prior.id_colaborador!==owner||prior.huella_entrada!==hash))throw new PersistenceError("EVENT_CONFLICT");
      if(prior&&prior.estado_tecnico!=="PENDIENTE")return {replay:prior.resultado_minimo} as const;
      // Legacy effects predate the incoming ledger. Never reuse such a Meta ID
      // for a different domain or reinterpret its old confirmation as a new draft.
      const legacy=(await c.query(`SELECT t.id_ticket::text,t.id_colaborador
        FROM public.tickets t WHERE t.id_mensaje_confirmacion=$1
        UNION ALL SELECT t.id_ticket::text,t.id_colaborador FROM public.operaciones_citas o
        JOIN public.tickets t USING(id_ticket) WHERE o.id_evento_meta=$1`,[key])).rows;
      if(legacy.length){
        if(legacy.some(r=>r.id_colaborador!==owner))throw new PersistenceError("EVENT_CONFLICT");
        return {replay:{version:1,codigo:"LEGACY_CONFIRMED",aplicado:true,folio:`RH-${legacy[0].id_ticket}`}} as const;
      }
      // Expire only inactive, unleased drafts; bounded cleanup independent of incoming owner.
      await c.query(`DELETE FROM public.contextos_conversacion WHERE (canal,id_colaborador) IN
        (SELECT canal,id_colaborador FROM public.contextos_conversacion
         WHERE vence_en<=clock_timestamp() AND (lease_hasta IS NULL OR lease_hasta<=clock_timestamp())
         ORDER BY vence_en LIMIT 100 FOR UPDATE SKIP LOCKED)`);
      await c.query(`WITH instant AS (SELECT clock_timestamp() AS t)
        INSERT INTO public.contextos_conversacion(canal,id_colaborador,ultimo_evento_nuevo_en,vence_en)
        SELECT 'whatsapp',$1,t,t+interval '120 minutes' FROM instant
        ON CONFLICT DO NOTHING`,[owner]);
      const row=(await c.query<ContextRow>(`SELECT estado,revision::text,lease_generacion::text,
        vence_en AS expires,clock_timestamp() AS now FROM public.contextos_conversacion
        WHERE canal='whatsapp' AND id_colaborador=$1 FOR UPDATE`,[owner])).rows[0];
      // A failed old message is not a license to confirm a DIFFERENT, newer draft.
      // Compare DB reception time with last committed NEW activity, never an ID prefix.
      if(prior){
        const activity=(await c.query(`SELECT ultimo_evento_nuevo_en FROM public.contextos_conversacion
          WHERE canal='whatsapp' AND id_colaborador=$1`,[owner])).rows[0].ultimo_evento_nuevo_en;
        if(new Date(prior.primera_recepcion_en).getTime()<new Date(activity).getTime()){
          const result={version:1,codigo:"STALE_PENDING_DISCARDED",aplicado:false};
          await c.query(`UPDATE public.eventos_entrantes SET estado_tecnico='PROCESADO',
            procesado_en=clock_timestamp(),revision_contexto_antes=$2,revision_contexto_despues=$2,
            resultado_minimo=$3::jsonb WHERE id_evento_meta=$1`,[key,row.revision,JSON.stringify(result)]);
          return {replay:result} as const;
        }
      }
      const busy=(await c.query(`SELECT 1 FROM public.contextos_conversacion
        WHERE canal='whatsapp' AND id_colaborador=$1 AND lease_hasta>clock_timestamp()`,[owner])).rowCount;
      if(busy)throw new PersistenceError("CONVERSATION_BUSY");
      await c.query(`UPDATE public.contextos_conversacion SET lease_token=$2,
        lease_hasta=clock_timestamp()+interval '90 seconds',lease_generacion=lease_generacion+1
        WHERE canal='whatsapp' AND id_colaborador=$1`,[owner,token]);
      if(!prior)await c.query(`INSERT INTO public.eventos_entrantes(id_evento_meta,canal,id_colaborador,huella_entrada)
        VALUES($1,'whatsapp',$2,$3)`,[key,owner,hash]);
      return {state:new Date(row.expires).getTime()<=new Date(row.now).getTime()?{}:row.estado,
        revision:row.revision,generation:(BigInt(row.lease_generacion)+1n).toString(),now:new Date(row.now).getTime()} as const;
    });
    if("replay"in claim) {
      const r=claim.replay;
      return {collaboratorStatus:"active" as const,classification:null,action:"durable_replay",
        reply:r?.folio?`La gestión ya fue registrada con folio ${r.folio}. No repetí cambios. Puedes consultar cita o volver al menú.`:
          "Este mensaje ya fue procesado. Conservé el estado actual sin repetir acciones ni renovar la actividad."};
    }
    let manager:ReturnType<typeof createCompleteReception>|undefined;
    try {
      const services=await deps.listActiveServices();
      const simple=/^(?:\d+|si|sí|no|confirmo|correcto|de acuerdo|hola|menu|menú|menu principal|menú principal|regresar|volver|cancelar|tema|viernes|fecha|explicacion|explicación)$/i;
      const extension=(claim.state.recepcion??{}) as Extension;
      const payroll=(claim.state.nomina as {draft?:{phase:string;serviceId:string}}|undefined)?.draft;
      const needsClassification=!simple.test(text)&&text.length>12&&
        !/^(?:consultar|cancelar|reprogramar|agendar|opciones|corregir)/i.test(text)&&
        !payroll?.serviceId&&!(extension.phase&&["summary","consent","booking","select","cancel","move","offer"].includes(extension.phase));
      const classification=needsClassification&&!unsupported?await deps.classifyService(text,services):
        {serviceId:null,classification:"sin clasificar" as const};
      const service=services.find(s=>s.idServicio===(extension.serviceId??classification.serviceId));
      let answer=null;
      if(!unsupported&&service?.categoria==="Políticas y procedimientos"&&
        !["summary","offer","booking","select","cancel","move","done"].includes(extension.phase??"")){
        const sources=(await pool.query(`SELECT id_fuente::text,nombre,categoria,url_drive,version,vigente_desde::text
          FROM public.fuentes WHERE activo IS TRUE AND categoria IN ($1,$2) ORDER BY id_fuente LIMIT 30`,
          [service.subcategoria,service.categoria])).rows;
        answer=await groundedAnswer(text,service.subcategoria??"",sources);
      }
      return await inAgendaTransaction(pool,async c=>{
        const lock=(await c.query(`SELECT revision::text,lease_generacion::text,lease_token,
          lease_hasta>clock_timestamp() AS valid FROM public.contextos_conversacion
          WHERE canal='whatsapp' AND id_colaborador=$1 FOR UPDATE`,[owner])).rows[0];
        if(!lock||lock.lease_token!==token||lock.revision!==claim.revision||
          lock.lease_generacion!==claim.generation||!lock.valid)throw new PersistenceError("LEASE_FENCED");
        await assertIdentity(c);
        const active=(await c.query("SELECT id_servicio::text AS id FROM public.servicios WHERE activo IS TRUE FOR SHARE")).rows.map(r=>r.id);
        if(services.some(s=>!active.includes(s.idServicio)))throw new PersistenceError("CATALOG_CHANGED");
        // Prior C4 confirmations are recovered by the original repositories, before drafts.
        const dbNow=new Date((await c.query("SELECT clock_timestamp() AS now")).rows[0].now).getTime();
        manager=createCompleteReception({lookupIdentity:async()=>identity,
          listActiveServices:async()=>services,classifyService:async()=>classification},pool,{classification,answer},dbNow);
        manager.importState(phone,claim.state);
        await c.query("SAVEPOINT message_business");
        let result:Awaited<ReturnType<typeof manager.handleMessage>>;
        try{result=unsupported?{collaboratorStatus:"active",classification:null,action:"unsupported_message",
          reply:"Para recibir tu solicitud necesito un mensaje de texto. No descargué ni registré el contenido del archivo; conservé lo que ya me habías indicado."}:
          await withTransactionClient(c,()=>manager!.handleMessage(phone,text,key));}
        catch(error){
          if(!(error instanceof PersistenceError)||!["SLOT_UNAVAILABLE","NOTICE_TOO_SHORT","ALREADY_BOOKED","INVALID_TRANSITION"].includes(error.code))throw error;
          await c.query("ROLLBACK TO SAVEPOINT message_business");
          manager.importState(phone,claim.state);
          const previous=manager.exportState(phone);
          const ext=previous.recepcion as Extension;
          if(ext?.ticketId){ext.phase="select";ext.choices=[];delete ext.selected;manager.importState(phone,{...previous,recepcion:ext});}
          else if(previous.agenda){
            const agendaState:Record<string,unknown>={...(previous.agenda as Record<string,unknown>),phase:"select",choices:[]};
            delete agendaState.selected;
            manager.importState(phone,{...previous,agenda:agendaState});
          }
          result={collaboratorStatus:"active",classification:null,action:"agenda_revalidation_rejected",
            reply:"La opción ya no está disponible o no cumple la anticipación. No registré el cambio; si había cita anterior, la conservé. Pide «opciones» para elegir de nuevo."};
        }
        await c.query("RELEASE SAVEPOINT message_business");
        const state=manager.exportState(phone);
        if(Buffer.byteLength(JSON.stringify(state))>16384)throw new PersistenceError("CONTEXT_TOO_LARGE");
        const applied=(await c.query("SELECT id_ticket::text,id_cita::text FROM public.operaciones_citas WHERE id_evento_meta=$1",[key])).rows[0];
        const ticket=applied??(await c.query("SELECT id_ticket::text FROM public.tickets WHERE id_mensaje_confirmacion=$1",[key])).rows[0];
        const voiceFolio=result.reply.match(/folio (VOZ-\d+)/)?.[1];
        const folio=voiceFolio??(ticket?`RH-${ticket.id_ticket}`:undefined);
        const minimum={version:1,codigo:result.action,aplicado:Boolean(ticket||voiceFolio),...(folio?{folio}:{})};
        await c.query(`WITH instant AS (SELECT clock_timestamp() AS t)
          UPDATE public.contextos_conversacion SET estado=$2::jsonb,revision=revision+1,
          ultimo_evento_nuevo_en=instant.t,vence_en=instant.t+interval '120 minutes',
          lease_token=NULL,lease_hasta=NULL FROM instant WHERE canal='whatsapp' AND id_colaborador=$1`,
          [owner,JSON.stringify(state)]);
        await c.query(`UPDATE public.eventos_entrantes SET estado_tecnico='PROCESADO',procesado_en=clock_timestamp(),
          revision_contexto_antes=$2,revision_contexto_despues=$2::bigint+1,
          id_ticket=$3,id_cita=$4,resultado_minimo=$5::jsonb WHERE id_evento_meta=$1`,
          [key,claim.revision,ticket?.id_ticket??null,applied?.id_cita??null,JSON.stringify(minimum)]);
        return result;
      });
    }catch(error) {
      // Release only our own fence, never a replacement owner's lease.
      await pool.query(`UPDATE public.contextos_conversacion SET lease_token=NULL,lease_hasta=NULL
        WHERE canal='whatsapp' AND id_colaborador=$1 AND lease_token=$2`,[owner,token]).catch(()=>{});
      throw error;
    }finally{manager?.dispose();}
  }
  return {handleMessage,handleUnsupported:(phone:string,type:string,hash:string,key:string)=>
    handleMessage(phone,"[mensaje no textual]",key,{type,hash}),dispose(){}};
}
