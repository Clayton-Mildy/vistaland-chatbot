"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { ApiError } from "@/lib/api/client";
import { createStaff, patchStaff, type StaffRole } from "@/lib/api/staff";

function message(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "EMAIL_TAKEN") return "Email sudah dipakai.";
    if (err.code === "VALIDATION_ERROR") return "Data belum lengkap.";
    if (err.code === "NOT_FOUND") return "Staf tidak ditemukan.";
  }
  return "Terjadi kesalahan. Silakan coba lagi.";
}

export async function createStaffAction(input: {
  email: string;
  password: string;
  displayName: string;
  role: StaffRole;
}): Promise<{ error?: string }> {
  await requireAdmin();
  try {
    await createStaff(input);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/staff");
  return {};
}

export async function updateStaffAction(
  id: string,
  patch: { displayName?: string; role?: StaffRole; isActive?: boolean }
): Promise<{ error?: string }> {
  await requireAdmin();
  try {
    await patchStaff(id, patch);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/staff");
  return {};
}

export async function resetStaffPasswordAction(id: string, password: string): Promise<{ error?: string }> {
  await requireAdmin();
  try {
    await patchStaff(id, { password });
  } catch (err) {
    return { error: message(err) };
  }
  return {};
}
