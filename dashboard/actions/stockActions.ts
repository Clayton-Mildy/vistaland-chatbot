"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { startVlesSync } from "@/lib/api/vles";
import { ApiError } from "@/lib/api/client";

export async function triggerVlesSync(): Promise<{ started: boolean; error?: string }> {
  await requireAdmin();
  try {
    const r = await startVlesSync();
    revalidatePath("/stock");
    return r;
  } catch (err) {
    if (err instanceof ApiError && err.code === "VLES_NOT_CONFIGURED") {
      return { started: false, error: "Kunci API VLES belum diatur di server." };
    }
    throw err;
  }
}
