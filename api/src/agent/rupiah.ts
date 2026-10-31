// Finds rupiah amounts in Indonesian text so a reply can be checked against what the tools said.
// Indonesian notation: "." groups thousands (2.834.123) and "," is the decimal mark (465,5 jt).

export type RupiahMention = { raw: string; value: number; tolerance: number };

// "3 jutaan" (around 3 million) is the everyday way to say it, so the "-an" forms count too.
const MULTIPLIERS: [RegExp, number][] = [
  [/^(rb|ribu|ribuan)$/i, 1e3],
  [/^(jt|juta|jutaan)$/i, 1e6],
  [/^(M|miliar|milyar|miliaran|milyaran)$/i, 1e9],
];

// "M" is case-sensitive on purpose: "62 m" is metres, not miliar.
const MENTION =
  /([Rr][Pp]\.?\s?)?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(?:\s?([Rr]b|[Rr]ibu(?:an)?|[Jj]t|[Jj]uta(?:an)?|[Mm]iliar(?:an)?|[Mm]ilyar(?:an)?|M)(?![A-Za-z]))?/g;

export function parseRupiahMentions(text: string): RupiahMention[] {
  const out: RupiahMention[] = [];
  for (const m of text.matchAll(MENTION)) {
    const [raw, rp, digits, unit] = m;
    if (!rp && !unit) continue; // a bare number is not money: "15 tahun", "2 kamar"
    const [whole, fraction = ''] = digits!.replace(/\.(?=\d{3})/g, '').split(',');
    const mult = unit ? (MULTIPLIERS.find(([re]) => re.test(unit))?.[1] ?? 1) : 1;
    const value = Number(`${whole}.${fraction || '0'}`) * mult;
    // Half of one unit of the last digit written ("465,5 jt" may mean 465,45-465,55 jt), but never
    // more than 2% of the amount: "Rp1 M" must not stand for 620 jt.
    const tolerance = Math.min(0.5 * 10 ** -fraction.length * mult, Math.max(0.5, 0.02 * value));
    out.push({ raw: raw!.trim(), value: Math.round(value * 100) / 100, tolerance });
  }
  return out;
}

/** Every number >= 1000 in a JSON value, plus every rupiah amount written in its strings. */
export function collectAmounts(value: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'number') {
      if (Number.isFinite(v) && Math.abs(v) >= 1000) out.push(v);
    } else if (typeof v === 'string') {
      for (const m of parseRupiahMentions(v)) out.push(m.value);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return out;
}
