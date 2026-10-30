// Display formatting for Indonesian staff: decimal comma, dot thousands, times in WIB.

const decimals = (max: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: max });

/** 465520000 -> "Rp465,5 jt"; 1250000000 -> "Rp1,25 M"; 950000 -> "Rp950 rb". */
export function formatRupiahShort(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `Rp${decimals(2).format(n / 1_000_000_000)} M`;
  if (Math.abs(n) >= 1_000_000) return `Rp${decimals(1).format(n / 1_000_000)} jt`;
  return `Rp${decimals(0).format(n / 1_000)} rb`;
}

/** 433425660 -> "Rp433.425.660". */
export function formatRupiah(n: number): string {
  return `Rp${decimals(0).format(n)}`;
}

const wibParts = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2026-10-30T12:57:26Z" -> "30 Okt 2026, 19.57 WIB". */
export function formatWib(value: string | Date): string {
  const parts = Object.fromEntries(wibParts.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}.${parts.minute} WIB`;
}
