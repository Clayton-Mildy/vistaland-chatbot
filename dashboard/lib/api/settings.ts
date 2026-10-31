import { apiFetch } from "./client";

export type AppSettings = { aiEnabled: boolean; personaGroupName: string; takeoverHours: number };
export type PromptVersion = { id: number; text: string; createdBy: string | null; createdAt: string | null };

export async function getSettings(): Promise<AppSettings> {
  const res = await apiFetch<AppSettings>("/settings");
  if (!res.data) throw new Error("Empty settings response");
  return res.data;
}
export const putSettings = (patch: Partial<AppSettings>) => apiFetch<AppSettings>("/settings", { method: "PUT", body: JSON.stringify(patch) });
export async function listPromptVersions(): Promise<PromptVersion[]> {
  return (await apiFetch<PromptVersion[]>("/prompt-versions")).data ?? [];
}
export const savePromptVersion = (text: string, staffId?: string) =>
  apiFetch<PromptVersion>("/prompt-versions", { method: "POST", body: JSON.stringify({ text }), headers: staffId ? { "X-Staff-Id": staffId } : {} });
