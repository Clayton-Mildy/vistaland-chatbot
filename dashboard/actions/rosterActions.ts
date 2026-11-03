"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { ApiError } from "@/lib/api/client";
import { addTimeOff, createAgent, deleteTimeOff, saveAvailability, updateAgent, type AgentPatch, type AvailabilityRow } from "@/lib/api/roster";

type Result = { error?: string };

function message(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INVALID_PHONE":
        return "Nomor WhatsApp tidak valid. Gunakan format 0812… atau 62812….";
      case "PHONE_TAKEN":
        return "Nomor WhatsApp sudah dipakai sales lain.";
      case "STAFF_LINKED":
        return "Akun itu sudah terhubung ke sales lain.";
      case "PROJECT_NOT_COVERED":
        return "Jam kerja hanya bisa diisi untuk proyek yang dicakup sales ini.";
      case "HAS_UPCOMING_VISITS":
        return `Masih ada ${err.count ?? 0} kunjungan mendatang. Alihkan dulu di Jadwal.`;
      case "VALIDATION_ERROR":
        return "Data belum lengkap atau formatnya salah.";
      case "NOT_FOUND":
        return "Data tidak ditemukan.";
    }
  }
  return "Terjadi kesalahan. Silakan coba lagi.";
}

async function run(fn: () => Promise<unknown>): Promise<Result> {
  await requireAdmin();
  try {
    await fn();
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/roster");
  return {};
}

export const createAgentAction = async (body: { name: string; waPhone: string; staffUserId: string | null; projectIds: number[] }) =>
  run(() => createAgent(body));
export const updateAgentAction = async (id: string, patch: AgentPatch) => run(() => updateAgent(id, patch));
export const saveAvailabilityAction = async (id: string, rows: AvailabilityRow[]) => run(() => saveAvailability(id, rows));
export const addTimeOffAction = async (id: string, body: { startsAt: string; endsAt: string; reason: string | null }) =>
  run(() => addTimeOff(id, body));
export const deleteTimeOffAction = async (id: number) => run(() => deleteTimeOff(id));
