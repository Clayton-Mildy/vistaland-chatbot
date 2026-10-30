import { apiFetch } from "./client";

export async function startVlesSync(): Promise<{ started: boolean }> {
  const res = await apiFetch<{ started: boolean }>("/vles/sync", { method: "POST" });
  return res.data ?? { started: false };
}
