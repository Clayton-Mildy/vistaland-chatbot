import { apiFetch } from "./client";

export type AvailabilityRow = { projectId: number; weekday: number; start: string; end: string };
export type TimeOffRow = { id: number; startsAt: string; endsAt: string; reason: string | null };

export type RosterAgent = {
  id: string;
  name: string;
  waPhone: string;
  staffUserId: string | null;
  staffEmail: string | null;
  active: boolean;
  projectIds: number[];
  availability: AvailabilityRow[];
  timeOff: TimeOffRow[];
};

export type AgentPatch = { name?: string; waPhone?: string; staffUserId?: string | null; active?: boolean; projectIds?: number[] };

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export async function listRoster(): Promise<RosterAgent[]> {
  return (await apiFetch<RosterAgent[]>("/roster")).data ?? [];
}
export const createAgent = (body: { name: string; waPhone: string; staffUserId: string | null; projectIds: number[] }) =>
  apiFetch<RosterAgent>("/roster/agents", json("POST", body));
export const updateAgent = (id: string, patch: AgentPatch) => apiFetch<RosterAgent>(`/roster/agents/${id}`, json("PATCH", patch));
export const saveAvailability = (id: string, rows: AvailabilityRow[]) => apiFetch(`/roster/agents/${id}/availability`, json("PUT", { rows }));
export const addTimeOff = (id: string, body: { startsAt: string; endsAt: string; reason: string | null }) =>
  apiFetch<TimeOffRow>(`/roster/agents/${id}/time-off`, json("POST", body));
export const deleteTimeOff = (id: number) => apiFetch(`/roster/time-off/${id}`, { method: "DELETE" });
