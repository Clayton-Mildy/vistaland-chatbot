import { parseRupiahMentions } from './rupiah.js';

// Deterministic checks on every reply before it reaches a customer (spec 5.5). Problems are in
// Bahasa Indonesia because they go back to the model as the reason to rewrite.

export type ReplyEvidence = {
  // Every amount the tools returned this turn, plus those in the project facts and lead state.
  knownAmounts: number[];
  toolsCalled: Set<string>;
  verifiedUnitNumbers: string[];
  subsidiNotes: string | null;
};

const PROMISES = [/(pasti|dijamin|100%)\s*(di-?)?(setujui|acc|lolos|approve)/i, /kpr(-?nya)?\s+(pasti|dijamin)/i];
// "tinggal" alone also means "to live (somewhere)", so only scarcity phrasings count.
const SCARCITY = [
  /\b(tinggal|sisa|tersisa)\s+(\d+|sedikit|beberapa|satu|dua|tiga|empat|lima)\b/i,
  /\b(hampir|segera)\s+habis\b/i,
  /\bterbatas\b/i,
];
const UNIT_NUMBER = /\b[A-Z]{1,3}\d{0,2}\/\d{1,3}[A-Z]?\b/g;
const SUBSIDY_VERDICT = /memenuhi syarat|lolos (syarat )?subsidi|berhak (mendapat(kan)? )?subsidi/i;

export function checkReply(text: string, ev: ReplyEvidence): { ok: true } | { ok: false; problems: string[] } {
  const problems: string[] = [];

  for (const m of parseRupiahMentions(text)) {
    if (!ev.knownAmounts.some((k) => Math.abs(k - m.value) <= m.tolerance)) {
      problems.push(`Nominal "${m.raw}" tidak ada di data alat atau fakta proyek. Pakai angka dari alat saja.`);
    }
  }
  if (PROMISES.some((re) => re.test(text))) problems.push('Jangan menjanjikan persetujuan KPR/subsidi.');
  if (SCARCITY.some((re) => re.test(text)) && !ev.toolsCalled.has('search_units') && !ev.toolsCalled.has('check_availability')) {
    problems.push('Klaim kelangkaan tanpa data stok.');
  }
  for (const [unit] of text.matchAll(UNIT_NUMBER)) {
    if (!ev.verifiedUnitNumbers.includes(unit)) problems.push(`Unit ${unit} belum dicek ketersediaannya.`);
  }
  if (SUBSIDY_VERDICT.test(text) && !ev.subsidiNotes) problems.push('Jangan menilai kelayakan subsidi.');

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
