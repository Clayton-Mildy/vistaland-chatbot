"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireSignedIn } from "@/lib/session";
import { ApiError } from "@/lib/api/client";
import { cancelVisit, listFreeSlots, markVisitOutcome, moveVisit, reassignVisit, type FreeSlot } from "@/lib/api/visits";

const ERROR_TEXT: Record<string, string> = {
  NOT_FOUND: "Kunjungan tidak ditemukan.",
  NOT_ACTIVE: "Kunjungan ini sudah tidak aktif.",
  SLOT_NOT_FREE: "Jam itu tidak tersedia. Pilih jam lain.",
  SLOT_TAKEN: "Jam itu baru saja terisi. Pilih jam lain.",
  HAS_ACTIVE_VISIT: "Konsumen sudah punya kunjungan aktif.",
  AGENT_NOT_FREE: "Sales itu tidak tersedia pada jam kunjungan ini.",
  TOO_EARLY: "Kunjungan belum dimulai.",
  VALIDATION_ERROR: "Data belum lengkap atau formatnya salah.",
  FORBIDDEN: "Anda tidak punya akses untuk ini.",
};

// Hiding a button is not enforcement; the API also refuses a sales user's admin-only calls and a
// visit outside their scope.
async function run<T>(id: string, adminOnly: boolean, fn: (staffId: string) => Promise<T>): Promise<{ error?: string; result?: T }> {
  if (adminOnly) await requireAdmin();
  const { id: staffId } = await requireSignedIn();
  let result: T;
  try {
    result = await fn(staffId);
  } catch (err) {
    return { error: (err instanceof ApiError && ERROR_TEXT[err.code]) || "Terjadi kesalahan. Silakan coba lagi." };
  }
  revalidatePath("/schedule");
  revalidatePath(`/visits/${id}`);
  return { result };
}

/** Moving books a new visit row, so the page to show next is the new id. */
export async function moveVisitAction(id: string, date: string, time: string): Promise<{ error?: string; visitId?: string }> {
  const r = await run(id, true, (s) => moveVisit(id, date, time, s));
  return r.error ? { error: r.error } : { visitId: r.result?.data?.visit.id };
}

export async function reassignVisitAction(id: string, salesAgentId: string): Promise<{ error?: string; notice?: "sent" | "queued" | "none" }> {
  const r = await run(id, true, (s) => reassignVisit(id, salesAgentId, s));
  return r.error ? { error: r.error } : { notice: r.result?.data?.notice };
}

export async function cancelVisitAction(id: string, reason: string): Promise<{ error?: string }> {
  const r = await run(id, true, (s) => cancelVisit(id, reason, s));
  return r.error ? { error: r.error } : {};
}

export async function outcomeAction(id: string, outcome: "visited" | "no_show"): Promise<{ error?: string }> {
  const r = await run(id, false, (s) => markVisitOutcome(id, outcome, s));
  return r.error ? { error: r.error } : {};
}

export async function freeSlotsAction(id: string, date: string): Promise<{ error?: string; slots?: FreeSlot[] }> {
  await requireAdmin();
  const { id: staffId } = await requireSignedIn();
  try {
    return { slots: await listFreeSlots(id, date, staffId) };
  } catch {
    return { error: "Gagal memuat jam kosong." };
  }
}
