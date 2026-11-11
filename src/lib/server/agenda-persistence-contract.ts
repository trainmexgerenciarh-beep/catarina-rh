import { createHash } from "node:crypto";
import { PersistenceError, requireEventId } from "./persistence-unit.ts";
import { dateNumber } from "./agenda-time.ts";

export type Operation = "RESERVAR" | "CANCELAR" | "REPROGRAMAR";
export type Modality = "PRESENCIAL" | "REMOTA";
export type AppointmentState = "PROGRAMADA" | "CANCELADA" | "REALIZADA" | "NO_ASISTIO";
export type AgendaCommand = {
  eventId: string;
  collaboratorId: string;
  ticketId: string;
  operation: Operation;
  appointmentId?: string;
  start?: string;
  modality: Modality;
  confirmed: true;
};
export type StoredAppointment = {
  id: string; ticketId: string; start: string; end: string;
  modality: Modality; status: AppointmentState;
};
export type AppliedResult = {
  version: 1; operation: Operation; ticketId: string; appointmentId: string;
  modality: Modality; status: "PROGRAMADA" | "CANCELADA"; start: string; end: string;
};
export type Receipt = {
  eventId: string; operation: Operation; ticketId: string; appointmentId: string;
  fingerprint: string; result: AppliedResult;
};
export interface PersistentAgenda {
  readonly mode: "SIMULATION_ONLY";
  execute(input: AgendaCommand): Promise<AppliedResult>;
  findApplied(eventId: string, collaboratorId: string): Promise<AppliedResult | null>;
  findAppointment(id: string, ticketId: string, collaboratorId: string): Promise<StoredAppointment | null>;
  forOwner(collaboratorId: string): Promise<StoredAppointment[]>;
  listAvailable(input: {
    ticketId: string; collaboratorId: string; date: string; modality: Modality;
  }): Promise<string[]>;
}

export function requireId(value: string): void {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new PersistenceError("INVALID_IDENTIFIER");
  }
}
export function canonicalInstant(value: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))) throw new PersistenceError("INVALID_INSTANT");
  try { dateNumber(value.slice(0, 10)); } catch { throw new PersistenceError("INVALID_INSTANT"); }
  return new Date(value).toISOString();
}
export function commandFingerprint(input: AgendaCommand): string {
  requireEventId(input.eventId);
  requireId(input.ticketId);
  if (!input.collaboratorId || input.confirmed !== true ||
    !["PRESENCIAL", "REMOTA"].includes(input.modality) ||
    !["RESERVAR", "CANCELAR", "REPROGRAMAR"].includes(input.operation)) {
    throw new PersistenceError("INVALID_COMMAND");
  }
  if (input.operation === "RESERVAR" ? input.appointmentId !== undefined : !input.appointmentId) {
    throw new PersistenceError("INVALID_COMMAND");
  }
  if (input.appointmentId) requireId(input.appointmentId);
  if (input.operation === "CANCELAR" && input.start !== undefined) throw new PersistenceError("INVALID_COMMAND");
  const destination = input.operation === "CANCELAR" ? null : canonicalInstant(input.start!);
  // Fixed field order, IDs remain decimal strings (never Number/BIGINT coercion).
  return createHash("sha256").update(JSON.stringify([
    1, input.operation, input.ticketId, input.appointmentId ?? null, destination, input.modality
  ])).digest("hex");
}

export function checkedResult(receipt: Receipt): AppliedResult {
  const r = receipt.result;
  const fields = ["version", "operation", "ticketId", "appointmentId", "modality", "status", "start", "end"];
  if (!r || typeof r !== "object" || Object.keys(r).sort().join() !== fields.sort().join() ||
    r.version !== 1 || r.operation !== receipt.operation || r.ticketId !== receipt.ticketId ||
    r.appointmentId !== receipt.appointmentId ||
    !["RESERVAR", "CANCELAR", "REPROGRAMAR"].includes(r.operation) ||
    !["PRESENCIAL", "REMOTA"].includes(r.modality) ||
    r.status !== (r.operation === "CANCELAR" ? "CANCELADA" : "PROGRAMADA") ||
    !/^[a-f0-9]{64}$/.test(receipt.fingerprint)) {
    throw new PersistenceError("INVALID_RECEIPT");
  }
  requireId(r.ticketId); requireId(r.appointmentId);
  if (canonicalInstant(r.start) !== r.start || canonicalInstant(r.end) !== r.end ||
    Date.parse(r.end) - Date.parse(r.start) !== 1_200_000) {
    throw new PersistenceError("INVALID_RECEIPT");
  }
  return structuredClone(r);
}
