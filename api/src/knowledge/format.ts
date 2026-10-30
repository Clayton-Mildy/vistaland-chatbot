// Same formatting as dashboard/lib/format.ts: the packages share no code, and Moni must quote
// amounts the way staff see them.

const decimals = (max: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: max });

/** 465520000 -> "Rp465,5 jt"; 1250000000 -> "Rp1,25 M"; 950000 -> "Rp950 rb". */
export function formatRupiahShort(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `Rp${decimals(2).format(n / 1_000_000_000)} M`;
  if (Math.abs(n) >= 1_000_000) return `Rp${decimals(1).format(n / 1_000_000)} jt`;
  return `Rp${decimals(0).format(n / 1_000)} rb`;
}

/** Today's date in Jakarta as YYYY-MM-DD. */
export function todayWib(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}

/** 433425660 -> "Rp433.425.660". */
export function formatRupiah(n: number): string {
  return `Rp${decimals(0).format(n)}`;
}
