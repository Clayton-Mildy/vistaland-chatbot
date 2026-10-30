import { apiFetch } from "./client";

export type StaffRole = "admin" | "sales";

export type Staff = {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
};

export async function listStaff(): Promise<Staff[]> {
  return (await apiFetch<Staff[]>("/staff")).data ?? [];
}

export async function createStaff(input: { email: string; password: string; displayName: string; role: StaffRole }): Promise<Staff | null> {
  return (await apiFetch<Staff>("/staff", { method: "POST", body: JSON.stringify(input) })).data;
}

export async function patchStaff(
  id: string,
  patch: { displayName?: string; role?: StaffRole; isActive?: boolean; password?: string }
): Promise<Staff | null> {
  return (await apiFetch<Staff>(`/staff/${id}`, { method: "PATCH", body: JSON.stringify(patch) })).data;
}
