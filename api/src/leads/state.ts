import type { Lead, LeadEvent } from './repository.js';
import { formatRupiah, formatRupiahShort } from '../knowledge/format.js';

// What Moni already knows about this lead, injected into the prompt each turn so it never asks
// twice or resends a material.

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const money = (v: number | null) => (v === null ? '—' : formatRupiahShort(v));
const PURPOSE = { own_use: 'ditempati', investment: 'investasi' } as const;

type MaterialPayload = { kind?: string; filename?: string };
type SimulationPayload = {
  typeName?: string;
  price?: number;
  dpPct?: number;
  tenorYears?: number;
  fixedYears?: number;
  monthlyFixed?: number;
  monthlyAfterFixed?: number | null;
};

export function buildLeadState(lead: Lead, events: LeadEvent[]): string {
  const lines = [`STATUS LEAD: ${lead.stage}`];
  lines.push(
    [
      `Nama: ${dash(lead.name)}`,
      `Budget: ${money(lead.budgetPrice)}`,
      `Cicilan: ${lead.budgetMonthly === null ? '—' : `${formatRupiahShort(lead.budgetMonthly)}/bulan`}`,
      `DP: ${money(lead.dpBudget)}`,
      `Kamar: ${dash(lead.bedroomsWanted)}`,
      `Tujuan: ${lead.purpose ? PURPOSE[lead.purpose] : '—'}`,
      `Waktu: ${dash(lead.timeline)}`,
      `Domisili: ${dash(lead.domicileArea)}`,
    ].join(' · ')
  );
  if (lead.concerns.length > 0) lines.push(`Keraguan: ${lead.concerns.join('; ')}`);

  const oldestFirst = [...events].reverse();
  const materials = oldestFirst
    .filter((e) => e.kind === 'material_sent')
    .map((e) => e.payload as MaterialPayload)
    .map((p) => `${p.kind ?? 'materi'}${p.filename ? ` (${p.filename})` : ''}`);
  if (materials.length > 0) lines.push(`Materi sudah dikirim: ${materials.join(', ')}`);

  const sims = oldestFirst
    .filter((e) => e.kind === 'simulation_sent')
    .map((e) => e.payload as SimulationPayload)
    .map((s) => {
      const after = s.monthlyAfterFixed ? `, lalu ${formatRupiah(s.monthlyAfterFixed)}` : '';
      return `${s.typeName ?? 'tipe'} ${s.price ? formatRupiahShort(s.price) : ''}, DP ${s.dpPct !== undefined ? Number(s.dpPct.toFixed(2)) : '—'}%, ${s.tenorYears} th: ${s.monthlyFixed ? formatRupiah(s.monthlyFixed) : '—'}/bulan (${s.fixedYears} th pertama)${after}`;
    });
  if (sims.length > 0) lines.push(`Simulasi sudah dikirim: ${sims.join('; ')}`);
  return lines.join('\n');
}
