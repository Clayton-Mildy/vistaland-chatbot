"use server";

import { requireSignedIn } from "@/lib/session";
import { removePushSubscription, savePushSubscription, type PushSubscriptionJson } from "@/lib/api/push";

type Result = { error?: string };

export async function subscribePushAction(sub: PushSubscriptionJson): Promise<Result> {
  const user = await requireSignedIn();
  try {
    await savePushSubscription(user.id, sub);
    return {};
  } catch {
    return { error: "Gagal mengaktifkan notifikasi. Silakan coba lagi." };
  }
}

export async function unsubscribePushAction(endpoint: string): Promise<Result> {
  await requireSignedIn();
  try {
    await removePushSubscription(endpoint);
    return {};
  } catch {
    return { error: "Gagal mematikan notifikasi. Silakan coba lagi." };
  }
}
