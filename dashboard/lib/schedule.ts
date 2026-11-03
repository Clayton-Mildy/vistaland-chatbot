import type { VisitRow, VisitStatus } from "@/lib/api/visits";

// Pure helpers for the Schedule page. WIB is a fixed UTC+7, so dates are plain arithmetic.
const WIB_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * A real "YYYY-MM-DD" date. The shape alone lets "2026-13-45" through, which makes the date
 * helpers throw; Date.parse refuses it, and the round trip refuses rollovers like "2026-02-30".
 */
export function isCalendarDate(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** `date` ("YYYY-MM-DD") moved by `days`. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday to Sunday of the week containing `date`. */
export function weekDates(date: string): string[] {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  const monday = shiftDate(date, 1 - weekday);
  return Array.from({ length: 7 }, (_, i) => shiftDate(monday, i));
}

/** The WIB calendar date of an instant, "YYYY-MM-DD". */
export const wibDay = (iso: string): string => new Date(Date.parse(iso) + WIB_OFFSET_MS).toISOString().slice(0, 10);

/** The WIB wall-clock time of an instant, "10.00". */
export const wibClock = (iso: string): string => new Date(Date.parse(iso) + WIB_OFFSET_MS).toISOString().slice(11, 16).replace(":", ".");

/** Visits by agent, then by date, each day sorted by time. Every agent and date has an entry; visits of other agents or dates are dropped. */
export function groupVisits(visits: VisitRow[], agentIds: string[], dates: string[]): Map<string, Map<string, VisitRow[]>> {
  const grouped = new Map(agentIds.map((a) => [a, new Map(dates.map((d) => [d, [] as VisitRow[]]))]));
  for (const v of [...visits].sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt))) {
    grouped.get(v.salesAgentId)?.get(wibDay(v.startsAt))?.push(v);
  }
  return grouped;
}

export const STATUS_STYLE: Record<VisitStatus, string> = {
  scheduled: "bg-blue-100 text-blue-900 border-blue-300",
  confirmed: "bg-green-100 text-green-900 border-green-300",
  awaiting_confirmation: "bg-amber-100 text-amber-900 border-amber-300",
  rescheduled: "bg-slate-100 text-slate-500 border-slate-300 line-through",
  cancelled: "bg-slate-100 text-slate-500 border-slate-300 line-through",
  visited: "bg-emerald-100 text-emerald-900 border-emerald-300",
  no_show: "bg-red-100 text-red-900 border-red-300",
};

/** "Sen, 2 Nov" for a "YYYY-MM-DD" date. */
export const dayLabel = (date: string): string =>
  new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));
