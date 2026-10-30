import { it, expect } from 'vitest';
import { simulateKpr, monthlyAnnuity, parseDpFromSchemeName, type KprAssumptions } from '../src/kpr/calculator.js';

const A: KprAssumptions = { fixedRatePct: 5, fixedYears: 3, floatingRatePct: 11, tenorOptions: [10, 15, 20], dpOptionsPct: [5] };

it('simulates 400 jt with 5% DP for 10, 15 and 20 years', () => {
  const s15 = simulateKpr({ price: 400_000_000, tenorYears: 15, assumptions: A });
  expect(s15).toMatchObject({ dpAmount: 20_000_000, loan: 380_000_000, monthlyFixed: 3_005_016, monthlyAfterFixed: 4_072_864 });
  expect(simulateKpr({ price: 400_000_000, tenorYears: 10, assumptions: A })).toMatchObject({ monthlyFixed: 4_030_490, monthlyAfterFixed: 4_882_712 });
  expect(simulateKpr({ price: 400_000_000, tenorYears: 20, assumptions: A })).toMatchObject({ monthlyFixed: 2_507_832, monthlyAfterFixed: 3_735_583 });
});

it('uses the scheme price and its 1% DP for BCA KPR 99%', () => {
  const dp = parseDpFromSchemeName('BCA KPR 99% BF 1JT PPN 0%')!;
  expect(dp).toBe(1);
  expect(simulateKpr({ price: 381_000_000, dpPct: dp, tenorYears: 15, assumptions: A })).toMatchObject({
    dpAmount: 3_810_000,
    loan: 377_190_000,
    monthlyFixed: 2_982_794,
    monthlyAfterFixed: 4_042_747,
  });
});

it('has no after-fixed instalment when the fixed period covers the tenor', () => {
  expect(simulateKpr({ price: 400_000_000, tenorYears: 3, assumptions: A })).toMatchObject({ monthlyFixed: 11_388_941, monthlyAfterFixed: null });
});

it('handles a zero rate and reads no DP from cash schemes', () => {
  expect(Math.round(monthlyAnnuity(120_000_000, 0, 120))).toBe(1_000_000);
  expect(parseDpFromSchemeName('CASH KERAS BF 1JT PPN 0%')).toBeNull();
  expect(parseDpFromSchemeName('KPR 95% BF 1JT PPN 0%')).toBe(5);
});

it('always states the bank-approval note', () => {
  expect(simulateKpr({ price: 1, tenorYears: 1, assumptions: A }).note).toBe('persetujuan KPR mengikuti penilaian bank');
});

it('a DP amount wins over a DP percentage', () => {
  expect(simulateKpr({ price: 400_000_000, dpAmount: 40_000_000, dpPct: 1, tenorYears: 15, assumptions: A })).toMatchObject({ dpAmount: 40_000_000, dpPct: 10, loan: 360_000_000 });
});
