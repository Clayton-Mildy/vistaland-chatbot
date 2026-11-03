import { apiFetch } from "./client";

export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };

/** The public VAPID key, or null while push is off on the API. */
export async function getPushPublicKey(): Promise<string | null> {
  return (await apiFetch<{ publicKey: string | null }>("/push/config")).data?.publicKey ?? null;
}

export const savePushSubscription = (staffId: string, sub: PushSubscriptionJson) =>
  apiFetch("/push/subscriptions", { method: "POST", body: JSON.stringify(sub), headers: { "X-Staff-Id": staffId } });

export const removePushSubscription = (endpoint: string) =>
  apiFetch("/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint }) });
