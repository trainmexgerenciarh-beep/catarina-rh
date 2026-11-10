export const AGENDA_ZONE = "America/Mexico_City";
export const SLOT_MS = 20 * 60_000;
export const NOTICE_MS = 120 * 60_000;

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: AGENDA_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

function parts(instant: number) {
  const values = Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return values;
}

export function localDate(instant: number): string {
  const p = parts(instant);
  return `${p.year}-${p.month}-${p.day}`;
}

export function dateNumber(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) {
    throw new Error("INVALID_DATE");
  }
  return value;
}

export function minutes(time: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("INVALID_TIME");
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

/** IANA zone conversion, not a hardcoded UTC offset or the process timezone. */
export function mexicoInstant(date: string, time: string): number {
  const desired = dateNumber(date) + minutes(time) * 60_000;
  let candidate = desired;
  for (let i = 0; i < 4; i++) {
    const p = parts(candidate);
    const rendered = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const correction = desired - rendered;
    if (correction === 0) return candidate;
    candidate += correction;
  }
  throw new Error("UNREPRESENTABLE_LOCAL_TIME");
}

export function plusDays(date: string, days: number): string {
  return new Date(dateNumber(date) + days * 86_400_000).toISOString().slice(0, 10);
}

export function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function displayAppointment(start: number): string {
  const p = parts(start);
  const end = parts(start + SLOT_MS);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}–${end.hour}:${end.minute} (${AGENDA_ZONE})`;
}
