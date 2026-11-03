import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { projects, salesAgentProjects, salesAgents, salesAvailability, salesTimeOff, visits } from '../db/schema/index.js';
import { ACTIVE_VISIT_STATUSES } from './roster.js';
import { addDays, atWib, wibDate, wibLabel, wibWeekday } from './time.js';

export const PARTS_OF_DAY = ['pagi', 'siang', 'sore'] as const;
export type PartOfDay = (typeof PARTS_OF_DAY)[number];
export const MAX_RANGE_DAYS = 14;

const STEP_MINUTES = 30;

export type Interval = { startsAt: Date; endsAt: Date };
export type SlotData = {
  project: {
    galleryHours: Record<string, [string, string] | null> | null;
    visitMinutes: number;
    sameDayMinNoticeMinutes: number;
  };
  agents: {
    id: string;
    availability: { weekday: number; start: string; end: string }[];
    timeOff: Interval[];
    busy: Interval[];
  }[];
};
export type Slot = { startsAt: Date; endsAt: Date; date: string; time: string; label: string; freeAgentIds: string[] };

const overlaps = (a: Interval, b: Interval) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Free visit slots, chronological, for WIB dates from `range.from` to `range.to` (at most 14 days, none in the past). */
export function freeSlots(data: SlotData, range: { from: string; to: string }, now: Date): Slot[] {
  const { galleryHours, visitMinutes, sameDayMinNoticeMinutes } = data.project;
  const earliest = new Date(now.getTime() + sameDayMinNoticeMinutes * 60_000);
  const today = wibDate(now);
  const first = range.from > today ? range.from : today;
  const lastAllowed = addDays(range.from, MAX_RANGE_DAYS - 1);
  const last = range.to < lastAllowed ? range.to : lastAllowed;

  const slots: Slot[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const weekday = wibWeekday(date);
    const hours = galleryHours?.[String(weekday)];
    if (!hours) continue;
    const close = toMinutes(hours[1]);
    for (let start = toMinutes(hours[0]); start + visitMinutes <= close; start += STEP_MINUTES) {
      const time = toHhmm(start);
      const end = toHhmm(start + visitMinutes);
      const slot = { startsAt: atWib(date, time), endsAt: atWib(date, end) };
      if (slot.startsAt < earliest) continue;
      const freeAgentIds = data.agents
        .filter(
          (a) =>
            a.availability.some((h) => h.weekday === weekday && h.start <= time && h.end >= end) &&
            !a.timeOff.some((t) => overlaps(t, slot)) &&
            !a.busy.some((b) => overlaps(b, slot))
        )
        .map((a) => a.id);
      if (freeAgentIds.length === 0) continue;
      slots.push({ ...slot, date, time, label: wibLabel(slot.startsAt), freeAgentIds });
    }
  }
  return slots;
}

function partOf(time: string): PartOfDay {
  return time < '12:00' ? 'pagi' : time < '15:00' ? 'siang' : 'sore';
}

/** A short, varied list to offer: ordered by the preference, at most `perDay` per date, then at most `max`. */
export function pickSlots(slots: Slot[], pref: { partOfDay?: PartOfDay; time?: string }, opts: { max?: number; perDay?: number } = {}): Slot[] {
  const { max = 6, perDay = 3 } = opts;
  const chronological = (a: Slot, b: Slot) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
  let ordered: Slot[];
  if (pref.time) {
    const target = toMinutes(pref.time);
    const distance = (s: Slot) => Math.abs(toMinutes(s.time) - target);
    ordered = [...slots].sort((a, b) => a.date.localeCompare(b.date) || distance(a) - distance(b) || a.time.localeCompare(b.time));
  } else if (pref.partOfDay) {
    const inPart = (s: Slot) => (partOf(s.time) === pref.partOfDay ? 0 : 1);
    ordered = [...slots].sort((a, b) => inPart(a) - inPart(b) || chronological(a, b));
  } else {
    ordered = [...slots].sort(chronological);
  }
  const perDate = new Map<string, number>();
  const picked: Slot[] = [];
  for (const s of ordered) {
    const n = perDate.get(s.date) ?? 0;
    if (n >= perDay) continue;
    perDate.set(s.date, n + 1);
    picked.push(s);
    if (picked.length >= max) break;
  }
  return picked;
}

/** Everything freeSlots needs for one project; null when the project does not exist. */
export async function loadSlotData(projectId: number, from: string, to: string, opts: { excludeVisitId?: string } = {}): Promise<SlotData | null> {
  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const rangeStart = atWib(from, '00:00');
  const rangeEnd = atWib(addDays(to, 1), '00:00');

  const agents = await db
    .select({ id: salesAgents.id })
    .from(salesAgents)
    .innerJoin(salesAgentProjects, eq(salesAgentProjects.salesAgentId, salesAgents.id))
    .where(and(eq(salesAgents.active, true), eq(salesAgentProjects.projectId, projectId)));
  const ids = agents.map((a) => a.id);

  const [hours, timeOff, busy] = ids.length
    ? await Promise.all([
        db.select().from(salesAvailability).where(and(eq(salesAvailability.projectId, projectId), inArray(salesAvailability.salesAgentId, ids))),
        db
          .select()
          .from(salesTimeOff)
          .where(and(inArray(salesTimeOff.salesAgentId, ids), lt(salesTimeOff.startsAt, rangeEnd), gt(salesTimeOff.endsAt, rangeStart))),
        db
          .select()
          .from(visits)
          .where(
            and(
              inArray(visits.salesAgentId, ids),
              inArray(visits.status, [...ACTIVE_VISIT_STATUSES]),
              eq(visits.isTest, false),
              lt(visits.startsAt, rangeEnd),
              gt(visits.endsAt, rangeStart)
            )
          ),
      ])
    : [[], [], []];

  return {
    project: {
      galleryHours: (project.galleryHours as SlotData['project']['galleryHours']) ?? null,
      visitMinutes: project.visitMinutes,
      sameDayMinNoticeMinutes: project.sameDayMinNoticeMinutes,
    },
    agents: ids.map((id) => ({
      id,
      availability: hours.filter((h) => h.salesAgentId === id).map((h) => ({ weekday: h.weekday, start: h.startTime, end: h.endTime })),
      timeOff: timeOff.filter((t) => t.salesAgentId === id).map((t) => ({ startsAt: t.startsAt, endsAt: t.endsAt })),
      busy: busy.filter((v) => v.salesAgentId === id && v.id !== opts.excludeVisitId).map((v) => ({ startsAt: v.startsAt, endsAt: v.endsAt })),
    })),
  };
}
