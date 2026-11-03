import { ApiError, apiFetch, type ApiEnvelope } from "./client";

export const STAGES = [
  "new", "engaged", "qualified", "recommended", "visit_proposed", "visit_scheduled",
  "visit_confirmed", "visited", "no_show", "cancelled", "lost", "opted_out",
] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  new: "Baru",
  engaged: "Sedang ngobrol",
  qualified: "Terkualifikasi",
  recommended: "Sudah direkomendasikan",
  visit_proposed: "Minta kunjungan",
  visit_scheduled: "Kunjungan dijadwalkan",
  visit_confirmed: "Kunjungan dikonfirmasi",
  visited: "Sudah berkunjung",
  no_show: "Tidak datang",
  cancelled: "Batal",
  lost: "Tidak lanjut",
  opted_out: "Minta tidak dihubungi",
};

export const VISIT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Dijadwalkan",
  confirmed: "Dikonfirmasi",
  awaiting_confirmation: "Menunggu konfirmasi",
  visited: "Sudah berkunjung",
  no_show: "Tidak datang",
  cancelled: "Dibatalkan",
  rescheduled: "Dijadwalkan ulang",
};

export type LeadRow = {
  id: string;
  name: string | null;
  waPhone: string;
  stage: Stage;
  project: { id: number; displayName: string | null } | null;
  sourceChannel: string | null;
  sourceContentKind: string | null;
  budgetPrice: number | null;
  budgetMonthly: number | null;
  bedroomsWanted: number | null;
  typeInterest: string[];
  hotCold: "hot" | "warm" | "cold" | null;
  lastCustomerMsgAt: string | null;
  underTakeover: boolean;
  needsAttention: boolean;
  assignedSales: { id: string; name: string } | null;
  nextVisit: { id: string; startsAt: string; status: string; label: string } | null;
};

export type LeadVisit = {
  id: string;
  startsAt: string;
  status: string;
  label: string;
  salesName: string;
  projectName: string;
};

export type HandoverSummary = {
  name: string;
  phone: string;
  source: string | null;
  location: string | null;
  purpose: string | null;
  need: string | null;
  budget: string | null;
  concerns: string[];
  materials: string[];
  simulations: string[];
  visit: { label: string; salesName: string; status: string } | null;
  notes: string | null;
};

export type Lead = {
  id: string;
  stage: Stage;
  name: string | null;
  budgetPrice: number | null;
  budgetMonthly: number | null;
  dpBudget: number | null;
  bedroomsWanted: number | null;
  purpose: "own_use" | "investment" | null;
  timeline: string | null;
  domicileArea: string | null;
  concerns: string[];
  typeInterest: number[];
  hotCold: "hot" | "warm" | "cold" | null;
  lostReason: string | null;
  currentProjectId: number | null;
  sourceChannel: string | null;
  sourceContentKind: string | null;
  sourceRef: string | null;
  createdAt: string;
};

export type LeadMessage = {
  id: string;
  direction: "in" | "out";
  sender: "customer" | "moni" | "staff" | "system";
  staffName: string | null;
  kind: string;
  body: string;
  mediaUrl: string | null;
  status: "received" | "sent" | "failed" | "recorded";
  createdAt: string;
};

export type LeadEvent = { id: number; kind: string; payload: Record<string, unknown>; actor: string; createdAt: string };

export type LeadDetail = {
  lead: Lead;
  contact: { id: string; waPhone: string; displayName: string | null; isTest: boolean; optedOutAt: string | null };
  conversation: { id: string; aiEnabled: boolean; humanTakeoverUntil: string | null } | null;
  messages: LeadMessage[];
  events: LeadEvent[];
  visits: LeadVisit[];
  summary: HandoverSummary | null;
  role: "admin" | "sales";
};

export type LeadFilters = { stage?: string; projectId?: string; channel?: string; from?: string; to?: string; q?: string; salesAgentId?: string; page?: string };
export type LeadPatch = Partial<Pick<Lead, "name" | "budgetPrice" | "budgetMonthly" | "dpBudget" | "bedroomsWanted" | "purpose" | "timeline" | "domicileArea" | "hotCold" | "lostReason" | "stage">>;

const staff = (staffId: string): HeadersInit => ({ "X-Staff-Id": staffId });

export async function listLeads(f: LeadFilters, staffId: string): Promise<ApiEnvelope<LeadRow[]>> {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  return apiFetch<LeadRow[]>(`/leads?${qs.toString()}`, { headers: staff(staffId) });
}
/** The lead, or null when it does not exist or is outside the account's scope (the API answers 404 for both). */
export async function getLeadDetail(id: string, staffId: string): Promise<LeadDetail | null> {
  try {
    return (await apiFetch<LeadDetail>(`/leads/${id}`, { headers: staff(staffId) })).data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
export const patchLead = (id: string, patch: LeadPatch, staffId: string) =>
  apiFetch<Lead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch), headers: staff(staffId) });
export const setLeadTakeover = (id: string, on: boolean, staffId: string) =>
  apiFetch(`/leads/${id}/takeover`, { method: "POST", body: JSON.stringify({ on }), headers: staff(staffId) });
export const setLeadAi = (id: string, enabled: boolean, staffId: string) =>
  apiFetch(`/leads/${id}/ai`, { method: "POST", body: JSON.stringify({ enabled }), headers: staff(staffId) });
export const sendStaffMessage = (id: string, body: string, staffId: string) =>
  apiFetch(`/leads/${id}/messages`, { method: "POST", body: JSON.stringify({ body }), headers: staff(staffId) });
