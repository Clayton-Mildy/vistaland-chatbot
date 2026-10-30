import { it, expect } from "vitest";
import { formatRupiahShort, formatRupiah, formatWib } from "@/lib/format";

it("formats rupiah in rb, jt and M with an Indonesian decimal comma", () => {
  expect(formatRupiahShort(465520000)).toBe("Rp465,5 jt");
  expect(formatRupiahShort(400000000)).toBe("Rp400 jt");
  expect(formatRupiahShort(1250000000)).toBe("Rp1,25 M");
  expect(formatRupiahShort(950000)).toBe("Rp950 rb");
});

it("formats full rupiah with dot thousands", () => {
  expect(formatRupiah(433425660)).toBe("Rp433.425.660");
});

it("formats instants in WIB", () => {
  expect(formatWib("2026-10-30T12:57:26Z")).toBe("30 Okt 2026, 19.57 WIB");
});
