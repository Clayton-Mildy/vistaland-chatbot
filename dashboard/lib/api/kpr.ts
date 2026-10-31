import { apiFetch } from "./client";

export type KprSettings = {
  id?: number;
  projectId: number;
  bankId: number | null;
  fixedRatePct: number;
  fixedYears: number;
  floatingRatePct: number;
  tenorOptions: number[];
  dpOptionsPct: number[];
  notes: string | null;
};
export type MortgageBank = { bankId: number; bankName: string | null; branchName: string | null };
export type SchemeName = { name: string; units: number; parsedDpPct: number | null; overrideDpPct: number | null };

export async function listKprSettings(projectId: number): Promise<KprSettings[]> {
  return (await apiFetch<KprSettings[]>(`/kpr-settings?projectId=${projectId}`)).data ?? [];
}
export const saveKprSettings = (s: KprSettings) => apiFetch<KprSettings>("/kpr-settings", { method: "PUT", body: JSON.stringify(s) });
export async function listMortgageBanks(projectId: number): Promise<MortgageBank[]> {
  return (await apiFetch<MortgageBank[]>(`/mortgage-banks?projectId=${projectId}`)).data ?? [];
}
export async function listSchemeNames(): Promise<SchemeName[]> {
  return (await apiFetch<SchemeName[]>("/scheme-names")).data ?? [];
}
export const saveSchemeOverride = (schemeName: string, dpPct: number) =>
  apiFetch("/scheme-dp-overrides", { method: "PUT", body: JSON.stringify({ schemeName, dpPct }) });
