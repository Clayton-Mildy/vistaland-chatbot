// KPR (mortgage) simulation as Indonesian banks quote it: a fixed rate for the first years, then a
// floating rate on the remaining balance. Estimates only; the bank decides.

export type KprAssumptions = {
  fixedRatePct: number;
  fixedYears: number;
  floatingRatePct: number;
  tenorOptions: number[];
  dpOptionsPct: number[];
};

export type KprSimulation = {
  price: number;
  dpAmount: number;
  dpPct: number;
  loan: number;
  tenorYears: number;
  fixedRatePct: number;
  fixedYears: number;
  floatingRatePct: number;
  monthlyFixed: number;
  // Null when the fixed period covers the whole tenor.
  monthlyAfterFixed: number | null;
  note: 'persetujuan KPR mengikuti penilaian bank';
};

/** Monthly instalment that pays `principal` off in `months` at `annualRatePct`. Unrounded. */
export function monthlyAnnuity(principal: number, annualRatePct: number, months: number): number {
  const r = annualRatePct / 1200;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - (1 + r) ** -months);
}

/** Balance left after `paid` instalments of `instalment` at `annualRatePct`. */
function remainingBalance(principal: number, annualRatePct: number, instalment: number, paid: number): number {
  const r = annualRatePct / 1200;
  if (r === 0) return principal - instalment * paid;
  const growth = (1 + r) ** paid;
  return principal * growth - (instalment * (growth - 1)) / r;
}

export function simulateKpr(input: {
  price: number;
  dpPct?: number;
  dpAmount?: number;
  tenorYears: number;
  assumptions: KprAssumptions;
}): KprSimulation {
  const { price, tenorYears, assumptions: a } = input;
  const dpAmount =
    input.dpAmount !== undefined
      ? Math.round(input.dpAmount)
      : Math.round((price * (input.dpPct ?? a.dpOptionsPct[0] ?? 0)) / 100);
  const dpPct = price > 0 ? (dpAmount / price) * 100 : 0;
  const loan = price - dpAmount;
  const months = tenorYears * 12;
  const fixedMonths = a.fixedYears * 12;

  const fixed = monthlyAnnuity(loan, a.fixedRatePct, months);
  let after: number | null = null;
  if (fixedMonths < months) {
    const balance = remainingBalance(loan, a.fixedRatePct, fixed, fixedMonths);
    after = monthlyAnnuity(balance, a.floatingRatePct, months - fixedMonths);
  }

  return {
    price,
    dpAmount,
    dpPct,
    loan,
    tenorYears,
    fixedRatePct: a.fixedRatePct,
    fixedYears: a.fixedYears,
    floatingRatePct: a.floatingRatePct,
    monthlyFixed: Math.round(fixed),
    monthlyAfterFixed: after === null ? null : Math.round(after),
    note: 'persetujuan KPR mengikuti penilaian bank',
  };
}

/** "BCA KPR 99% BF 1JT" finances 99%, so the DP is 1%. Null for names that do not say. */
export function parseDpFromSchemeName(name: string): number | null {
  const m = /KPR\s*(\d{1,3})\s*%/i.exec(name);
  if (!m) return null;
  const financed = Number(m[1]);
  return financed > 100 ? null : 100 - financed;
}
