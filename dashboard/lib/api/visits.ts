import { ApiError, apiFetch, type ApiEnvelope } from "./client";
import type { HandoverSummary } from "./leads";

export const VISIT_STATUSES = ["scheduled", "confirmed", "awaiting_confirmation", "rescheduled", "cancelled", "visited", "no_show"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** A visit on the Schedule page; `customerName` is the lead's name. */
export type VisitRow = {
  id: string;
  leadId: string;
  salesAgentId: string;
  salesName: string;
  projectId: number;
  projectName: string;
  customerName: string | null;
  startsAt: string;
  status: VisitStatus;
};

export type VisitDetail = {
  visit: VisitRow & { endsAt: string; label: string; mapsUrl: string | null; cancelReason: string | null };
  lead: { id: string; name: string; phone: string };
  summary: HandoverSummary | null;
};

export type FreeSlot = { startsAt: string; date: string; time: string; label: string };
export type OutboundMeta = { held: number; failed: number };
export type VisitFilters = { from: string; to: string; projectId?: string; salesAgentId?: string };

const staff = (staffId: string): HeadersInit => ({ "X-Staff-Id": staffId });
const post = (path: string, body: unknown, staffId: string) =>
  apiFetch<{ visit: VisitRow; notice?: "sent" | "queued" | "none" }>(path, { method: "POST", body: JSON.stringify(body), headers: staff(staffId) });

/** Visits starting in the inclusive WIB date range; the outbound counts come back for admins only. */
export async function listVisits(f: VisitFilters, staffId: string): Promise<{ visits: VisitRow[]; outbound: OutboundMeta | null }> {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  const res = (await apiFetch<VisitRow[]>(`/visits?${qs.toString()}`, { headers: staff(staffId) })) as ApiEnvelope<VisitRow[]> & { meta?: { outbound?: OutboundMeta } };
  return { visits: res.data ?? [], outbound: res.meta?.outbound ?? null };
}

/** The visit, or null when it does not exist or is outside the account's scope (the API answers 404 for both). */
export async function getVisitDetail(id: string, staffId: string): Promise<VisitDetail | null> {
  try {
    return (await apiFetch<VisitDetail>(`/visits/${id}`, { headers: staff(staffId) })).data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function listFreeSlots(id: string, date: string, staffId: string): Promise<FreeSlot[]> {
  return (await apiFetch<FreeSlot[]>(`/visits/${id}/slots?date=${encodeURIComponent(date)}`, { headers: staff(staffId) })).data ?? [];
}

export const moveVisit = (id: string, date: string, time: string, staffId: string) => post(`/visits/${id}/move`, { date, time }, staffId);
export const reassignVisit = (id: string, salesAgentId: string, staffId: string) => post(`/visits/${id}/reassign`, { salesAgentId }, staffId);
export const cancelVisit = (id: string, reason: string, staffId: string) => post(`/visits/${id}/cancel`, { reason }, staffId);
export const markVisitOutcome = (id: string, outcome: "visited" | "no_show", staffId: string) => post(`/visits/${id}/outcome`, { outcome }, staffId);
