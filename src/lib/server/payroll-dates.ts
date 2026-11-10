export type FridayReference =
  | { kind: "explicit" | "candidate"; date: string }
  | { kind: "invalid" | "missing" | "ambiguous" };

export function normalizePayrollInput(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es").trim().replace(/\s+/g, " ");
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function checkedDate(year: number, month: number, day: number): FridayReference {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
      date.getUTCDay() !== 5) return { kind: "invalid" };
  return { kind: "explicit", date: date.toISOString().slice(0, 10) };
}

/** Calendar arithmetic only. Never claims that payroll was actually paid. */
export function parseFriday(text: string, now: number): FridayReference {
  const input = normalizePayrollInput(text);
  const explicitReferences = [
    ...input.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g),
    ...input.matchAll(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/g),
    ...input.matchAll(/\b\d{1,2} de [a-z]+(?: de)? \d{4}\b/g)
  ];
  if (explicitReferences.length > 1) return { kind: "ambiguous" };
  const iso = input.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return checkedDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = input.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (numeric) return checkedDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const named = input.match(/\b(\d{1,2}) de ([a-z]+)(?: de)? (\d{4})\b/);
  if (named) return checkedDate(Number(named[3]), MONTHS.indexOf(named[2]) + 1, Number(named[1]));

  // Relative dates are always proposed for confirmation, never silently assumed.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(now));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const today = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const weekday = today.getUTCDay();
  let offset: number | null = null;
  if (/\b(?:viernes pasado|viernes anterior)\b/.test(input)) {
    offset = -((weekday - 5 + 7) % 7 || 7);
  } else if (/\b(?:ultimo pago|pago mas reciente|ultimo viernes)\b/.test(input)) {
    offset = -((weekday - 5 + 7) % 7);
  } else if (/\b(?:esta semana|semana actual|este viernes)\b/.test(input)) {
    offset = 5 - (weekday === 0 ? 7 : weekday);
  } else if (/\bsemana pasada\b/.test(input)) {
    offset = 5 - (weekday === 0 ? 7 : weekday) - 7;
  }
  if (offset === null) return { kind: "missing" };
  today.setUTCDate(today.getUTCDate() + offset);
  return { kind: "candidate", date: today.toISOString().slice(0, 10) };
}

export function displayFriday(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}
