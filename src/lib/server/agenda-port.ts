import type { SimulatedAgenda, Appointment } from "./agenda-simulation.ts";
import type { PersistentAgenda, StoredAppointment, AppliedResult } from "./agenda-persistence-contract.ts";
import { localDate, plusDays } from "./agenda-time.ts";

type Methods = Pick<SimulatedAgenda,"list"|"active"|"forOwner"|"book"|"cancel"|"reschedule">;
export type AgendaPort = {
  [K in keyof Methods]: (...args: Parameters<Methods[K]>) =>
    ReturnType<Methods[K]> | Promise<ReturnType<Methods[K]>>;
} & {
  mode: "simulation" | "SIMULATION_ONLY";
  recover?(eventId: string, owner: string): Promise<AppliedResult | null>;
};

/** Shape translation only: all authorization, clock, locks and mutation remain
 * in the C2 SQL repository. No second scheduling engine or outbound transport.
 */
export function persistentAgendaPort(repository: PersistentAgenda): AgendaPort {
  const view = (r: StoredAppointment | AppliedResult, owner: string): Appointment => ({
    id: "appointmentId" in r ? r.appointmentId : r.id, ticketId:r.ticketId, collaboratorId:owner,
    start:Date.parse(r.start),end:Date.parse(r.end),modality:"presencial",
    status:r.status === "CANCELADA" ? "cancelada" : "confirmada"
  });
  const forOwner = async (owner: string) => (await repository.forOwner(owner))
    .filter(r=>r.modality==="PRESENCIAL").map(r=>view(r,owner));
  return {
    mode:"SIMULATION_ONLY",recover:(key,owner)=>repository.findApplied(key,owner),forOwner,
    async active(ticketId,owner){return (await forOwner(owner)).filter(r=>r.ticketId===ticketId);},
    async list(input){
      const starts:number[]=[];
      const first=input.date??localDate(input.now);
      for(let day=0;day<(input.days??14);day++){
        const date=plusDays(first,day);
        starts.push(...(await repository.listAvailable({
          ticketId:input.ticketId,collaboratorId:input.collaboratorId,date,modality:"PRESENCIAL"
        })).map(Date.parse));
      }
      return starts;
    },
    async book(input){
      return view(await repository.execute({
        eventId:input.key,collaboratorId:input.collaboratorId,ticketId:input.ticketId,
        operation:"RESERVAR",start:new Date(input.start).toISOString(),modality:"PRESENCIAL",confirmed:true
      }),input.collaboratorId);
    },
    async cancel(input){
      return view(await repository.execute({
        eventId:input.key,collaboratorId:input.collaboratorId,ticketId:input.ticketId,
        operation:"CANCELAR",appointmentId:input.id,modality:"PRESENCIAL",confirmed:true
      }),input.collaboratorId);
    },
    async reschedule(input){
      return view(await repository.execute({
        eventId:input.key,collaboratorId:input.collaboratorId,ticketId:input.ticketId,
        operation:"REPROGRAMAR",appointmentId:input.id,start:new Date(input.start).toISOString(),
        modality:"PRESENCIAL",confirmed:true
      }),input.collaboratorId);
    }
  };
}
