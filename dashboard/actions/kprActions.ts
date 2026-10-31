"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { ApiError } from "@/lib/api/client";
import { saveKprSettings, saveSchemeOverride, type KprSettings } from "@/lib/api/kpr";

async function run(fn: () => Promise<unknown>): Promise<{ error?: string }> {
  await requireAdmin();
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === "VALIDATION_ERROR") return { error: "Angka belum lengkap atau di luar batas." };
    return { error: "Terjadi kesalahan. Silakan coba lagi." };
  }
  revalidatePath("/kpr");
  return {};
}

export const saveKprSettingsAction = async (s: KprSettings) => run(() => saveKprSettings(s));
export const saveSchemeOverrideAction = async (name: string, dpPct: number) => run(() => saveSchemeOverride(name, dpPct));
