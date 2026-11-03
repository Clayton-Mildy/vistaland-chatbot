// WIB (Asia/Jakarta) is a fixed UTC+7 with no daylight saving, so the offset is written out
// (as in routes/leads.ts) and no timezone library is needed.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

/** The WIB calendar date of an instant, "YYYY-MM-DD". */
export function wibDate(d: Date): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** The WIB wall-clock time of an instant, "HH:MM". */
export function wibTime(d: Date): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(11, 16);
}

/** ISO weekday of a "YYYY-MM-DD" date: 1 = Monday ... 7 = Sunday. */
export function wibWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

/** The instant at which the WIB clock reads `date` `time` ("HH:MM"). */
export function atWib(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+07:00`);
}

export function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** "Jumat, 30 Oktober 2026 10.00 WIB". */
export function wibLabel(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.weekday}, ${p.day} ${p.month} ${p.year} ${p.hour}.${p.minute} WIB`;
}

/** "KALENDER: Sen 2026-11-02, Sel 2026-11-03, ..." for `days` days starting today (WIB). */
export function calendarWib(now: Date, days: number): string {
  const today = wibDate(now);
  const items = Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    return `${WEEKDAY_SHORT[wibWeekday(date) - 1]} ${date}`;
  });
  return `KALENDER: ${items.join(', ')}`;
}
