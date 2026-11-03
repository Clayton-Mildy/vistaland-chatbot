import { it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { getDb } from '../src/db/client.js';
import { contacts, leads, projects, visits } from '../src/db/schema/index.js';
import { listProjects } from '../src/repositories/projects.js';
import { addTimeOff, createAgent, setAvailability, updateAgent } from '../src/scheduling/roster.js';
import { MAX_RANGE_DAYS, freeSlots, loadSlotData, pickSlots, type Slot, type SlotData } from '../src/scheduling/slots.js';
import { addDays, atWib, calendarWib, wibDate, wibLabel, wibTime, wibWeekday } from '../src/scheduling/time.js';
import { nowWibLabel } from '../src/agent/prompt.js';

// Monday 2026-11-02, 10.00 WIB.
const now = new Date('2026-11-02T03:00:00Z');
const SAT = { from: '2026-11-07', to: '2026-11-07' };
const iv = (date: string, from: string, to: string) => ({ startsAt: atWib(date, from), endsAt: atWib(date, to) });

function dataWith(agents: SlotData['agents'], galleryHours: SlotData['project']['galleryHours'] = { '6': ['09:00', '17:00'] }): SlotData {
  return { project: { galleryHours, visitMinutes: 60, sameDayMinNoticeMinutes: 120 }, agents };
}
const agentA = (over: Partial<SlotData['agents'][number]> = {}): SlotData['agents'][number] => ({
  id: 'a',
  availability: [{ weekday: 6, start: '09:00', end: '17:00' }],
  timeOff: [],
  busy: [],
  ...over,
});
const data = dataWith([agentA()]);

it('time helpers read the WIB date, time and weekday', () => {
  const d = new Date('2026-11-06T23:30:00Z'); // Sat 06.30 WIB
  expect(wibDate(d)).toBe('2026-11-07');
  expect(wibTime(d)).toBe('06:30');
  expect(wibWeekday('2026-11-07')).toBe(6);
  expect(wibWeekday('2026-11-08')).toBe(7);
  expect(wibWeekday('2026-11-09')).toBe(1);
  expect(atWib('2026-11-07', '10:00').toISOString()).toBe('2026-11-07T03:00:00.000Z');
  expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  expect(addDays('2026-11-02', -2)).toBe('2026-10-31');
  expect(wibLabel(atWib('2026-11-07', '10:00'))).toBe('Sabtu, 7 November 2026 10.00 WIB');
  expect(nowWibLabel(atWib('2026-11-07', '10:00'))).toBe('Sabtu, 7 November 2026 10.00 WIB');
});

it('calendarWib lists the days from today with Indonesian weekday names', () => {
  expect(calendarWib(now, 4)).toBe('KALENDER: Sen 2026-11-02, Sel 2026-11-03, Rab 2026-11-04, Kam 2026-11-05');
  expect(calendarWib(now, 7).endsWith('Min 2026-11-08')).toBe(true);
});

it('the last slot ends at closing time', () => {
  const s = freeSlots(data, SAT, now);
  expect(s[0]!.time).toBe('09:00');
  expect(s.at(-1)!.time).toBe('16:00');
  expect(s).toHaveLength(15);
  expect(s.at(-1)!.endsAt).toEqual(atWib('2026-11-07', '17:00'));
});

it('a closed day has no slots', () => {
  const d = dataWith([agentA({ availability: [{ weekday: 7, start: '09:00', end: '17:00' }] })], { '6': ['09:00', '17:00'], '7': null });
  expect(freeSlots(d, { from: '2026-11-08', to: '2026-11-08' }, now)).toEqual([]);
  expect(freeSlots(dataWith([agentA()], null), SAT, now)).toEqual([]);
  expect(freeSlots(dataWith([agentA()], {}), SAT, now)).toEqual([]);
});

it('the notice period applies from now', () => {
  const n = new Date('2026-11-07T03:10:00Z'); // Sat 10.10 WIB
  expect(freeSlots(data, SAT, n)[0]!.time).toBe('12:30');
});

it('days before today are skipped', () => {
  const n = new Date('2026-11-07T10:00:00Z'); // Sat 17.00 WIB, nothing left today
  expect(freeSlots(data, { from: '2026-11-01', to: '2026-11-07' }, n)).toEqual([]);
  const weekdays = dataWith(
    [agentA({ availability: [{ weekday: 1, start: '09:00', end: '17:00' }, { weekday: 6, start: '09:00', end: '17:00' }] })],
    { '1': ['09:00', '10:00'], '6': ['09:00', '17:00'] }
  );
  // Monday 2026-11-02 05.00 WIB: the earlier Monday and Saturday in the range are past.
  const monday = freeSlots(weekdays, { from: '2026-10-26', to: '2026-11-02' }, new Date('2026-11-01T22:00:00Z'));
  expect(monday.map((s) => `${s.date} ${s.time}`)).toEqual(['2026-11-02 09:00']);
});

it('availability must cover the whole slot', () => {
  const d = dataWith([agentA({ availability: [{ weekday: 6, start: '09:00', end: '10:30' }] })]);
  expect(freeSlots(d, SAT, now).map((s) => s.time)).toEqual(['09:00', '09:30']);
});

it('an agent without availability that weekday is never free', () => {
  const d = dataWith([agentA({ availability: [{ weekday: 5, start: '09:00', end: '17:00' }] })]);
  expect(freeSlots(d, SAT, now)).toEqual([]);
});

it('time off removes the agent, another agent keeps the slot free', () => {
  const b: SlotData['agents'][number] = { ...agentA({ id: 'b' }) };
  const d = dataWith([agentA({ timeOff: [iv('2026-11-07', '10:00', '12:00')] }), b]);
  const s = freeSlots(d, SAT, now);
  expect(s.find((x) => x.time === '10:00')!.freeAgentIds).toEqual(['b']);
  expect(s.find((x) => x.time === '09:00')!.freeAgentIds).toEqual(['a', 'b']);
  expect(s.find((x) => x.time === '12:00')!.freeAgentIds).toEqual(['a', 'b']);
});

it('a slot nobody is free for is dropped', () => {
  const d = dataWith([agentA({ timeOff: [iv('2026-11-07', '09:00', '17:00')] })]);
  expect(freeSlots(d, SAT, now)).toEqual([]);
});

it('a busy visit blocks overlapping slots but not adjacent ones', () => {
  const d = dataWith([agentA({ busy: [iv('2026-11-07', '10:00', '11:00')] })]);
  const times = freeSlots(d, SAT, now).map((s) => s.time);
  expect(times).not.toContain('09:30');
  expect(times).not.toContain('10:00');
  expect(times).not.toContain('10:30');
  expect(times).toContain('09:00');
  expect(times).toContain('11:00');
});

it('a WIB morning is on the WIB date, not the UTC date', () => {
  const n = new Date('2026-11-06T23:30:00Z'); // Sat 06.30 WIB, Fri in UTC
  const s = freeSlots(data, SAT, n);
  expect(s[0]).toMatchObject({ date: '2026-11-07', time: '09:00' });
});

it('slot labels carry the weekday of the WIB date', () => {
  expect(freeSlots(data, SAT, now)[0]!.label).toBe('Sabtu, 7 November 2026 09.00 WIB');
});

it('a range is capped at 14 days', () => {
  const everyDay = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((w) => [String(w), ['09:00', '10:00'] as [string, string]]));
  const d = dataWith(
    [agentA({ availability: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '09:00', end: '17:00' })) })],
    everyDay
  );
  const from = '2026-11-03';
  const s = freeSlots(d, { from, to: addDays(from, 30) }, now);
  expect(MAX_RANGE_DAYS).toBe(14);
  expect(s.at(-1)!.date).toBe(addDays(from, 13));
  expect(new Set(s.map((x) => x.date)).size).toBe(14);
});

const sat = freeSlots(data, SAT, now);

it('pickSlots with a time returns the nearest first, three per day', () => {
  expect(pickSlots(sat, { time: '10:00' }).map((s) => s.time)).toEqual(['10:00', '09:30', '10:30']);
});

it('pickSlots prefers the part of day, then fills from the rest', () => {
  expect(pickSlots(sat, { partOfDay: 'sore' }).map((s) => s.time)).toEqual(['15:00', '15:30', '16:00']);
  expect(pickSlots(sat, { partOfDay: 'sore' }, { perDay: 10, max: 5 }).map((s) => s.time)).toEqual(['15:00', '15:30', '16:00', '09:00', '09:30']);
  // 12:00 is siang, 11:30 is still pagi.
  expect(pickSlots(sat, { partOfDay: 'siang' }, { perDay: 4 }).map((s) => s.time)).toEqual(['12:00', '12:30', '13:00', '13:30']);
  expect(pickSlots(sat, { partOfDay: 'pagi' }, { perDay: 20, max: 20 }).slice(0, 5).map((s) => s.time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
});

it('pickSlots without a preference is chronological, capped per day and in total', () => {
  const sun = freeSlots(
    dataWith([agentA({ availability: [{ weekday: 6, start: '09:00', end: '17:00' }, { weekday: 7, start: '09:00', end: '17:00' }] })], {
      '6': ['09:00', '17:00'],
      '7': ['09:00', '17:00'],
    }),
    { from: '2026-11-07', to: '2026-11-08' },
    now
  );
  expect(pickSlots(sun, {}).map((s) => `${s.date} ${s.time}`)).toEqual([
    '2026-11-07 09:00', '2026-11-07 09:30', '2026-11-07 10:00',
    '2026-11-08 09:00', '2026-11-08 09:30', '2026-11-08 10:00',
  ]);
  expect(pickSlots(sun, {}, { max: 4 })).toHaveLength(4);
});

it('pickSlots with a time orders by date first', () => {
  const two: Slot[] = [
    { ...sat[0]!, date: '2026-11-08', time: '10:00' },
    { ...sat[0]!, date: '2026-11-07', time: '16:00' },
  ];
  expect(pickSlots(two, { time: '10:00' }).map((s) => s.date)).toEqual(['2026-11-07', '2026-11-08']);
});

// ─── loadSlotData ──────────────────────────────────────────────────────────

beforeEach(async () => {
  await truncate('projects', 'contacts', 'sales_agents', 'staff_users');
  await seedProjects();
});

let phone = 6283000000;
async function newLead() {
  const [c] = await getDb().insert(contacts).values({ waPhone: String(phone++) }).returning();
  const [lead] = await getDb().insert(leads).values({ contactId: c!.id }).returning();
  return lead!.id;
}

it('loadSlotData returns null for an unknown project', async () => {
  expect(await loadSlotData(999999, '2026-11-07', '2026-11-07')).toBeNull();
});

it('loadSlotData ignores test visits and inactive agents and counts visits in other projects', async () => {
  const [p1, p2] = (await listProjects()).map((p) => p.id);
  await getDb()
    .update(projects)
    .set({ galleryHours: { '6': ['09:00', '17:00'] }, visitMinutes: 45, sameDayMinNoticeMinutes: 90 })
    .where(eq(projects.id, p1!));
  const active = await createAgent({ name: 'Rina', waPhone: '6281000001', staffUserId: null, projectIds: [p1!, p2!] });
  const inactive = await createAgent({ name: 'Budi', waPhone: '6281000002', staffUserId: null, projectIds: [p1!] });
  const elsewhere = await createAgent({ name: 'Sari', waPhone: '6281000003', staffUserId: null, projectIds: [p2!] });
  await setAvailability(active.id, [
    { projectId: p1!, weekday: 6, start: '09:00', end: '17:00' },
    { projectId: p2!, weekday: 6, start: '08:00', end: '12:00' },
  ]);
  await setAvailability(inactive.id, [{ projectId: p1!, weekday: 6, start: '09:00', end: '17:00' }]);
  await setAvailability(elsewhere.id, [{ projectId: p2!, weekday: 6, start: '09:00', end: '17:00' }]);
  await updateAgent(inactive.id, { active: false });

  const mk = async (
    projectId: number,
    date: string,
    start: string,
    end: string,
    extra: { isTest?: boolean; status?: 'scheduled' | 'cancelled' | 'visited' } = {}
  ) => {
    const leadId = await newLead();
    const [v] = await getDb()
      .insert(visits)
      .values({ leadId, projectId, salesAgentId: active.id, ...iv(date, start, end), createdBy: 'moni', ...extra })
      .returning();
    return v!;
  };
  const other = await mk(p2!, '2026-11-07', '10:00', '11:00'); // another project: counts
  await mk(p1!, '2026-11-07', '12:00', '13:00', { isTest: true }); // test: ignored
  await mk(p1!, '2026-11-07', '13:00', '14:00', { status: 'cancelled' }); // not active: ignored
  await mk(p1!, '2026-11-07', '14:00', '15:00', { status: 'visited' }); // not active: ignored
  await mk(p1!, '2026-11-07', '16:00', '17:00'); // counts
  await mk(p1!, '2026-11-14', '09:00', '10:00'); // outside the requested range: ignored
  await addTimeOff(active.id, { startsAt: atWib('2026-11-07', '11:00'), endsAt: atWib('2026-11-07', '12:00'), reason: null });
  await addTimeOff(active.id, { startsAt: atWib('2026-11-20', '11:00'), endsAt: atWib('2026-11-20', '12:00'), reason: null }); // out of range

  const loaded = (await loadSlotData(p1!, '2026-11-07', '2026-11-07'))!;
  expect(loaded.project).toEqual({ galleryHours: { '6': ['09:00', '17:00'] }, visitMinutes: 45, sameDayMinNoticeMinutes: 90 });
  expect(loaded.agents.map((a) => a.id)).toEqual([active.id]);
  const a = loaded.agents[0]!;
  expect(a.availability).toEqual([{ weekday: 6, start: '09:00', end: '17:00' }]);
  expect(a.timeOff).toEqual([iv('2026-11-07', '11:00', '12:00')]);
  expect(a.busy).toHaveLength(2);
  expect(a.busy).toContainEqual(iv('2026-11-07', '10:00', '11:00'));
  expect(a.busy).toContainEqual(iv('2026-11-07', '16:00', '17:00'));

  const excluded = (await loadSlotData(p1!, '2026-11-07', '2026-11-07', { excludeVisitId: other.id }))!;
  expect(excluded.agents[0]!.busy).toEqual([iv('2026-11-07', '16:00', '17:00')]);
});
