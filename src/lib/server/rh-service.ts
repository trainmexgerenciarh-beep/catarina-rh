import type pg from "pg";
import {inAgendaTransaction,type ConnectionPool,PersistenceError} from "./persistence-unit.ts";
import type {Role} from "./admin-auth.ts";
import {readSource,driveId} from "./institutional-sources.ts";
import {dateNumber,minutes,mexicoInstant} from "./agenda-time.ts";
export const resources=["dashboard","colaboradores","servicios","tickets","citas","bloqueos","fuentes","consultas","voz","encuestas","configuracion"] as const;
export type Resource=typeof resources[number];
type Data=Record<string,unknown>;
const text=(d:Data,k:string,max=1000)=>{const s=String(d[k]??"").trim();if(!s||s.length>max)throw new PersistenceError("INVALID_INPUT");return s;};
const id=(d:Data,k:string)=>{const v=text(d,k,30);if(!/^[1-9]\d*$/.test(v))throw new PersistenceError("INVALID_IDENTIFIER");return v;};
export const queries:Record<string,string>={
  colaboradores:"SELECT id_colaborador,nombre,whatsapp,centro,departamento,puesto,activo FROM public.colaboradores ORDER BY nombre,id_colaborador LIMIT 2000",
  servicios:"SELECT id_servicio::text,categoria,subcategoria,activo FROM public.servicios ORDER BY categoria,subcategoria",
  tickets:`SELECT t.*,t.id_ticket::text,'RH-'||t.id_ticket AS folio,c.nombre,c.centro,c.departamento,s.categoria,s.subcategoria
    FROM public.tickets t LEFT JOIN public.colaboradores c USING(id_colaborador)
    LEFT JOIN public.servicios s USING(id_servicio) ORDER BY t.creado_en DESC LIMIT 2000`,
  citas:`SELECT a.*,a.id_cita::text,a.id_ticket::text,c.nombre,t.resumen
    FROM public.citas a JOIN public.tickets t USING(id_ticket) LEFT JOIN public.colaboradores c USING(id_colaborador)
    ORDER BY a.inicio_programado DESC LIMIT 2000`,
  bloqueos:"SELECT *,id_bloqueo::text FROM public.bloqueos_agenda ORDER BY fecha,hora_inicio LIMIT 2000",
  fuentes:"SELECT *,id_fuente::text,vigente_desde::text FROM public.fuentes ORDER BY nombre",
  consultas:"SELECT *,id_consulta::text FROM public.consultas ORDER BY fecha DESC LIMIT 2000",
  voz:"SELECT *,id_denuncia::text,'VOZ-'||id_denuncia AS folio FROM public.denuncias ORDER BY recibida_en DESC LIMIT 2000",
  encuestas:`SELECT e.id_encuesta::text,e.id_cita::text,e.enviada_en,e.respondida_en,
    e.calificacion,e.resolucion,e.comentario,e.recibio_atencion,
    e.entrega->>'state' AS estado_entrega,e.entrega->>'mode' AS modo_entrega,
    a.inicio_programado,a.modalidad
    FROM public.encuestas e JOIN public.citas a USING(id_cita) ORDER BY e.id_encuesta DESC LIMIT 2000`
};
export async function readRH(pool:pg.Pool,resource:string,role:Role) {
  if(!resources.includes(resource as Resource))throw new PersistenceError("NOT_FOUND");
  if(resource==="voz"&&role!=="gerente")throw new PersistenceError("ACCESS_DENIED");
  if(resource==="configuracion")return [
    {label:"WhatsApp",value:"BLOQUEADO",detail:"Sin envíos automáticos. Requiere aprobación y lista autorizada."},
    {label:"Neon",value:"Persistente",detail:"14 tablas; agenda institucional compartida"},
    {label:"Google Drive",value:"Verificable por fuente",detail:"Registra URL, versión y vigencia; verifica permisos antes de responder."},
    {label:"Google Sheets",value:process.env.RH_EXPORT_SPREADSHEET_ID?"Configurado; verificar permisos":"Destino pendiente",detail:"Archivo mensual de tickets ordinarios cerrados, sin Tu Voz ni borrado."},
    {label:"Encuestas",value:"Entrega durable FAKE_ONLY",detail:"Día siguiente, reclamación/reintentos en Neon; sin envío real ni cron externo activado"},
    {label:"Contexto",value:"120 minutos",detail:"Compartido, revisionado y con lease/fencing; sin transcripciones completas"}
  ];
  if(resource==="dashboard"){
    const r=(await pool.query(`SELECT
      (SELECT count(*) FROM public.colaboradores WHERE activo IS TRUE)::int AS activos,
      (SELECT count(*) FROM public.tickets WHERE cerrado_en IS NULL)::int AS abiertos,
      (SELECT count(*) FROM public.citas WHERE estado='PROGRAMADA')::int AS citas,
      (SELECT count(*) FROM public.consultas WHERE resultado='documentacion faltante')::int AS faltantes,
      (SELECT round(avg(calificacion),1) FROM public.encuestas WHERE recibio_atencion IS TRUE) AS satisfaccion,
      (SELECT round(avg(extract(epoch FROM(resuelto_en-creado_en))/3600),1) FROM public.tickets WHERE resuelto_en IS NOT NULL) AS horas_resolucion,
      (SELECT round(avg(extract(epoch FROM(inicio_real-inicio_programado))/60),1) FROM public.citas WHERE inicio_real IS NOT NULL) AS demora_atencion`)).rows[0];
    const metrics=[
      {label:"Colaboradores activos",value:r.activos,detail:"Directorio autorizado"},
      {label:"Tickets abiertos",value:r.abiertos,detail:"Asuntos pendientes de RH"},
      {label:"Citas programadas",value:r.citas,detail:"Presencial y remota, una agenda"},
      {label:"Faltantes documentales",value:r.faltantes,detail:"Consultas sin fuente suficiente"},
      {label:"Satisfacción",value:r.satisfaccion??"—",detail:"Promedio sobre 5, solo atención recibida"},
      {label:"Resolución promedio",value:r.horas_resolucion??"—",detail:"Horas; solo resolución explícita RH"},
      {label:"Demora de atención",value:r.demora_atencion??"—",detail:"Minutos respecto a hora programada"}
    ];
    const grouped=(await pool.query(`SELECT s.categoria,c.centro,c.departamento,count(*)::int AS cantidad
      FROM public.tickets t LEFT JOIN public.servicios s USING(id_servicio)
      LEFT JOIN public.colaboradores c USING(id_colaborador) GROUP BY s.categoria,c.centro,c.departamento`)).rows;
    return [...metrics,...grouped.map(g=>({label:g.categoria??"Sin categoría",value:g.cantidad,detail:`${g.centro??"Sin centro"} · ${g.departamento??"Sin departamento"}`}))];
  }
  return (await pool.query(queries[resource])).rows;
}
export async function prepareSurveys(pool:ConnectionPool) {
  return inAgendaTransaction(pool,async c=>{
    const rows=(await c.query(`INSERT INTO public.encuestas(id_cita)
      SELECT a.id_cita FROM public.citas a JOIN public.tickets t USING(id_ticket)
      JOIN public.colaboradores c USING(id_colaborador) JOIN public.servicios s USING(id_servicio)
      WHERE a.estado<>'CANCELADA' AND c.activo IS TRUE
        AND regexp_replace(coalesce(c.whatsapp,''),'[^0-9]','','g') ~ '^[0-9]{8,15}$'
        AND s.categoria IN ('Nómina y prestaciones','Políticas y procedimientos')
        AND (a.inicio_programado AT TIME ZONE 'America/Mexico_City')::date
            < (clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date
        AND NOT EXISTS(SELECT 1 FROM public.encuestas e WHERE e.id_cita=a.id_cita)
      ORDER BY a.id_cita LIMIT 100 RETURNING id_encuesta::text`)).rows;
    return {prepared:rows.length,outbound:false};
  });
}
export async function writeRH(pool:pg.Pool,resource:string,action:string,d:Data,role:Role) {
  if(resource==="voz")throw new PersistenceError("ACCESS_DENIED");
  if(resource==="fuentes"&&action==="save"&&role!=="gerente")throw new PersistenceError("ACCESS_DENIED");
  if(resource==="encuestas"&&action==="prepare")return prepareSurveys(pool);
  if(resource==="fuentes"&&action==="verify") {
    const r=(await pool.query("SELECT *,vigente_desde::text FROM public.fuentes WHERE id_fuente=$1",[id(d,"id_fuente")])).rows[0];
    if(!r)throw new PersistenceError("NOT_FOUND");
    try{await readSource(r);}catch{throw new PersistenceError("DRIVE_READ_NOT_CONFIRMED");}
    return {verified:true,readOnly:true,officialApproval:"NOT_INFERRED"};
  }
  // Source activation is the manager's explicit approval of this exact version.
  // Read Drive BEFORE opening a DB transaction. Reading is not content approval.
  if(resource==="fuentes"&&action==="save"&&d.activo===true){
    try{await readSource({id_fuente:String(d.id_fuente??""),nombre:text(d,"nombre",180),
      categoria:text(d,"categoria",180),url_drive:text(d,"url_drive",500),
      version:text(d,"version",80),vigente_desde:text(d,"vigente_desde",10)});}
    catch{throw new PersistenceError("DRIVE_READ_NOT_CONFIRMED");}
  }
  return inAgendaTransaction(pool,async c=>{
    if(resource==="colaboradores"&&action==="save"){
      const owner=text(d,"id_colaborador",80),name=text(d,"nombre",150),phone=text(d,"whatsapp",30).replace(/\D/g,"");
      if(!/^\d{8,15}$/.test(phone)||typeof d.activo!=="boolean")throw new PersistenceError("INVALID_INPUT");
      const dup=await c.query("SELECT 1 FROM public.colaboradores WHERE regexp_replace(coalesce(whatsapp,''),'[^0-9]','','g')=$1 AND id_colaborador<>$2",[phone,owner]);
      if(dup.rowCount)throw new PersistenceError("PHONE_ALREADY_REGISTERED");
      return (await c.query(`INSERT INTO public.colaboradores(id_colaborador,nombre,whatsapp,centro,departamento,puesto,activo)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id_colaborador) DO UPDATE SET
        nombre=$2,whatsapp=$3,centro=$4,departamento=$5,puesto=$6,activo=$7 RETURNING id_colaborador`,
        [owner,name,phone,text(d,"centro",150),text(d,"departamento",150),text(d,"puesto",150),d.activo])).rows[0];
    }
    if(resource==="servicios"&&action==="save"){
      if(role!=="gerente"||typeof d.activo!=="boolean")throw new PersistenceError("ACCESS_DENIED");
      return (await c.query("UPDATE public.servicios SET activo=$2 WHERE id_servicio=$1 RETURNING id_servicio",[id(d,"id_servicio"),d.activo])).rows[0];
    }
    if(resource==="tickets"&&["close","resolve"].includes(action)){
      const result=text(d,"resultado",2000);
      const r=await c.query(`UPDATE public.tickets SET estado=$2,resultado=$3,cerrado_en=clock_timestamp(),
        resuelto_en=CASE WHEN $4 THEN clock_timestamp() ELSE resuelto_en END
        WHERE id_ticket=$1 AND cerrado_en IS NULL RETURNING id_ticket`,
        [id(d,"id_ticket"),action==="resolve"?"resuelto":"cerrado por RH",result,action==="resolve"]);
      if(!r.rowCount)throw new PersistenceError("INVALID_TRANSITION");return r.rows[0];
    }
    if(resource==="citas"&&action==="attendance"){
      if(!["REALIZADA","NO_ASISTIO"].includes(String(d.estado)))throw new PersistenceError("INVALID_INPUT");
      const actual=(value:unknown)=>{
        if(!value)return null;
        const v=String(value);
        if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v))throw new PersistenceError("INVALID_ACTUAL_TIME");
        return new Date(mexicoInstant(v.slice(0,10),v.slice(11))).toISOString();
      };
      const begin=d.estado==="REALIZADA"?actual(d.inicio_real):null;
      const end=d.estado==="REALIZADA"?actual(d.fin_real):null;
      if(Boolean(begin)!==Boolean(end)||begin&&end&&Date.parse(begin)>=Date.parse(end))throw new PersistenceError("INVALID_ACTUAL_TIME");
      const r=await c.query(`UPDATE public.citas SET estado=$2,observaciones=$3,inicio_real=$4,fin_real=$5
        WHERE id_cita=$1 AND estado='PROGRAMADA' AND fin_programado<=clock_timestamp() RETURNING id_cita`,
        [id(d,"id_cita"),d.estado,String(d.observaciones??"").slice(0,2000),begin,end]);
      if(!r.rowCount)throw new PersistenceError("APPOINTMENT_NOT_ENDED");return r.rows[0];
    }
    if(resource==="bloqueos"){
      if(action==="delete")return (await c.query("DELETE FROM public.bloqueos_agenda WHERE id_bloqueo=$1 RETURNING id_bloqueo",[id(d,"id_bloqueo")])).rows[0];
      if(action==="save"){
        const date=text(d,"fecha",10),begin=text(d,"hora_inicio",5),end=text(d,"hora_fin",5);
        dateNumber(date);if(minutes(begin)>=minutes(end))throw new PersistenceError("INVALID_INPUT");
        const conflict=await c.query(`SELECT 1 FROM public.citas WHERE estado='PROGRAMADA'
          AND inicio_programado<$2::timestamptz AND fin_programado>$1::timestamptz`,
          [new Date(mexicoInstant(date,begin)).toISOString(),new Date(mexicoInstant(date,end)).toISOString()]);
        if(conflict.rowCount)throw new PersistenceError("BLOCK_CONFLICTS_WITH_APPOINTMENT");
        if(d.id_bloqueo)return (await c.query("UPDATE public.bloqueos_agenda SET fecha=$2,hora_inicio=$3,hora_fin=$4,motivo=$5 WHERE id_bloqueo=$1 RETURNING id_bloqueo",
          [id(d,"id_bloqueo"),date,begin,end,text(d,"motivo",300)])).rows[0];
        return (await c.query("INSERT INTO public.bloqueos_agenda(fecha,hora_inicio,hora_fin,motivo) VALUES($1,$2,$3,$4) RETURNING id_bloqueo",
          [date,begin,end,text(d,"motivo",300)])).rows[0];
      }
    }
    if(resource==="fuentes"&&action==="save"){
      driveId(text(d,"url_drive",500));
      dateNumber(text(d,"vigente_desde",10));if(typeof d.activo!=="boolean")throw new PersistenceError("INVALID_INPUT");
      const p=[text(d,"nombre",180),text(d,"categoria",180),d.url_drive,text(d,"version",80),d.vigente_desde,d.activo];
      if(d.id_fuente)return (await c.query("UPDATE public.fuentes SET nombre=$1,categoria=$2,url_drive=$3,version=$4,vigente_desde=$5,activo=$6 WHERE id_fuente=$7 RETURNING id_fuente",[...p,id(d,"id_fuente")])).rows[0];
      return (await c.query("INSERT INTO public.fuentes(nombre,categoria,url_drive,version,vigente_desde,activo) VALUES($1,$2,$3,$4,$5,$6) RETURNING id_fuente",p)).rows[0];
    }
    if(resource==="encuestas"&&action==="respond"){
      if(typeof d.recibio_atencion!=="boolean")throw new PersistenceError("INVALID_INPUT");
      const attended=d.recibio_atencion;
      const rating=attended?Number(d.calificacion):null;
      if(attended&&(!Number.isInteger(rating)||rating!<1||rating!>5||!["Sí","Parcialmente","No"].includes(String(d.resolucion))))throw new PersistenceError("INVALID_SURVEY");
      const r=await c.query(`UPDATE public.encuestas SET recibio_atencion=$2,calificacion=$3,resolucion=$4,
        comentario=$5,respondida_en=clock_timestamp() WHERE id_encuesta=$1 AND respondida_en IS NULL RETURNING id_encuesta`,
        [id(d,"id_encuesta"),attended,rating,attended?d.resolucion:null,String(d.comentario??"").slice(0,1000)]);
      if(!r.rowCount)throw new PersistenceError("SURVEY_ALREADY_ANSWERED");return r.rows[0];
    }
    throw new PersistenceError("ACTION_NOT_SUPPORTED");
  });
}
