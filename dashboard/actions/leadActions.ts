"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireSignedIn } from "@/lib/session";
import { ApiError } from "@/lib/api/client";
import { patchLead, sendStaffMessage, setLeadAi, setLeadTakeover, type LeadPatch } from "@/lib/api/leads";

// Hiding a control is not enforcement; the API also refuses a sales user's admin-only calls and a
// lead outside their scope.
async function run(id: string, adminOnly: boolean, fn: (staffId: string) => Promise<unknown>): Promise<{ error?: string }> {
  if (adminOnly) await requireAdmin();
  const { id: staffId } = await requireSignedIn();
  try {
    await fn(staffId);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === "TEST_CONTACT") return { error: "Ini kontak uji chat; pesan tidak dikirim ke WhatsApp." };
      if (err.code === "SEND_FAILED") return { error: "Pesan gagal terkirim lewat ChakraHQ. Coba lagi." };
      if (err.code === "CHAKRA_NOT_CONFIGURED") return { error: "ChakraHQ belum diatur di server." };
      if (err.code === "NOT_FOUND") return { error: "Lead tidak ditemukan." };
      if (err.code === "VALIDATION_ERROR") return { error: "Data belum lengkap atau formatnya salah." };
    }
    return { error: "Terjadi kesalahan. Silakan coba lagi." };
  }
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  return {};
}

export const patchLeadAction = async (id: string, patch: LeadPatch) => run(id, true, (s) => patchLead(id, patch, s));
export const takeoverAction = async (id: string, on: boolean) => run(id, false, (s) => setLeadTakeover(id, on, s));
export const aiAction = async (id: string, enabled: boolean) => run(id, true, (s) => setLeadAi(id, enabled, s));
export const sendStaffMessageAction = async (id: string, body: string) => run(id, false, (s) => sendStaffMessage(id, body, s));
