import { it, expect } from 'vitest';
import { parseRupiahMentions, collectAmounts } from '../src/agent/rupiah.js';
import { checkReply, type ReplyEvidence } from '../src/agent/replyChecks.js';

it('parses rupiah with precision-based tolerance', () => {
  expect(parseRupiahMentions('mulai Rp465,5 jt atau Rp 400 juta, cicilan Rp2.834.123')).toEqual([
    { raw: 'Rp465,5 jt', value: 465_500_000, tolerance: 50_000 },
    { raw: 'Rp 400 juta', value: 400_000_000, tolerance: 500_000 },
    { raw: 'Rp2.834.123', value: 2_834_123, tolerance: 0.5 },
  ]);
  expect(parseRupiahMentions('tenor 15 tahun, 2 kamar, DP 5%, LT 62 m², 15 menit')).toEqual([]);
  expect(parseRupiahMentions('Rp1,2 M')[0]).toMatchObject({ value: 1_200_000_000, tolerance: 50_000_000 });
  expect(parseRupiahMentions('booking fee 500 ribu')[0]).toMatchObject({ value: 500_000, tolerance: 500 });
});

it('collects numbers and rupiah strings from tool output', () => {
  expect(collectAmounts({ a: 465_520_000, b: [12, 'mulai Rp400 jt'], c: { d: 3_005_016 } }).sort((x, y) => x - y)).toEqual([3_005_016, 400_000_000, 465_520_000]);
});

const ev = (o: Partial<ReplyEvidence> = {}): ReplyEvidence => ({
  knownAmounts: [465_520_000, 3_005_016],
  toolsCalled: new Set(),
  verifiedUnitNumbers: [],
  subsidiNotes: null,
  ...o,
});

it('accepts rounded known amounts and rejects invented ones', () => {
  expect(checkReply('Harganya Rp465,5 jt, cicilan sekitar Rp3 jt/bulan', ev()).ok).toBe(true);
  const r = checkReply('Harganya Rp450 jt', ev());
  expect(r).toEqual({ ok: false, problems: ['Nominal "Rp450 jt" tidak ada di data alat atau fakta proyek. Pakai angka dari alat saja.'] });
});

it('rejects promised approval and unsupported scarcity', () => {
  expect(checkReply('KPR-nya pasti disetujui kok Kak', ev()).ok).toBe(false);
  expect(checkReply('Dijamin lolos Kak', ev()).ok).toBe(false);
  expect(checkReply('Unitnya tinggal sedikit Kak', ev()).ok).toBe(false);
  expect(checkReply('Stoknya terbatas ya Kak', ev()).ok).toBe(false);
  expect(checkReply('Unitnya tinggal sedikit Kak', ev({ toolsCalled: new Set(['search_units']) })).ok).toBe(true);
});

it('does not read "tinggal" (to live) as a scarcity claim', () => {
  expect(checkReply('Kakak tinggal di daerah mana sekarang?', ev()).ok).toBe(true);
  expect(checkReply('Rumahnya untuk ditinggali sendiri atau investasi?', ev()).ok).toBe(true);
});

it('a unit number without a verified check is rejected', () => {
  expect(checkReply('Unit D3/15 masih tersedia', ev())).toEqual({ ok: false, problems: ['Unit D3/15 belum dicek ketersediaannya.'] });
  expect(checkReply('Unit D3/15 masih tersedia', ev({ verifiedUnitNumbers: ['D3/15'] })).ok).toBe(true);
  expect(checkReply('Unit A/06 ada Kak', ev()).ok).toBe(false);
});

it('subsidy eligibility needs admin notes', () => {
  expect(checkReply('Kakak berhak subsidi', ev()).ok).toBe(false);
  expect(checkReply('Kakak berhak subsidi', ev({ subsidiNotes: 'Syarat: belum punya rumah, gaji maks 8 jt' })).ok).toBe(true);
});

it('lists every problem at once', () => {
  const r = checkReply('Pasti di-ACC, unit D3/15 Rp999 jt', ev());
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.problems).toHaveLength(3);
});
