"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { ApiError } from "@/lib/api/client";
import { putSettings, savePromptVersion, type AppSettings } from "@/lib/api/settings";

async function run(fn: (staffId: string | undefined) => Promise<unknown>): Promise<{ error?: string }> {
  await requireAdmin();
  try {
    await fn((await auth())?.user?.id);
  } catch (err) {
    if (err instanceof ApiError && err.code === "VALIDATION_ERROR") return { error: "Isian belum sesuai (cek panjang teks atau batas angka)." };
    return { error: "Terjadi kesalahan. Silakan coba lagi." };
  }
  revalidatePath("/settings");
  return {};
}

export const saveSettingsAction = async (patch: Partial<AppSettings>) => run(() => putSettings(patch));
export const savePromptAction = async (text: string) => run((staffId) => savePromptVersion(text, staffId));
