"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { ApiError } from "@/lib/api/client";
import {
  createMaterial,
  deactivateMaterial,
  deleteChannelTag,
  saveChannelTag,
  savePromoCopy,
  saveTypeProfile,
  updateMaterial,
  updateProject,
  type ChannelTag,
  type MaterialInput,
  type ProjectPatch,
  type TypeProfile,
} from "@/lib/api/catalog";

type Result = { error?: string };

async function run(projectId: number, fn: () => Promise<unknown>): Promise<Result> {
  await requireAdmin();
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === "VALIDATION_ERROR") return { error: "Data belum lengkap atau formatnya salah." };
    if (err instanceof ApiError && err.code === "NOT_FOUND") return { error: "Data tidak ditemukan." };
    return { error: "Terjadi kesalahan. Silakan coba lagi." };
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  return {};
}

export const updateProjectAction = async (id: number, patch: ProjectPatch) => run(id, () => updateProject(id, patch));
export const saveTypeProfileAction = async (projectId: number, houseTypeId: number, body: Omit<TypeProfile, "houseTypeId">) =>
  run(projectId, () => saveTypeProfile(houseTypeId, body));
export const createMaterialAction = async (body: MaterialInput) => run(body.projectId, () => createMaterial(body));
export const updateMaterialAction = async (projectId: number, id: number, patch: Partial<MaterialInput>) =>
  run(projectId, () => updateMaterial(id, patch));
export const deactivateMaterialAction = async (projectId: number, id: number) => run(projectId, () => deactivateMaterial(id));
export const savePromoCopyAction = async (projectId: number, id: number, customerText: string, termsText: string | null) =>
  run(projectId, () => savePromoCopy(id, customerText, termsText));
export const saveChannelTagAction = async (tag: ChannelTag) => run(tag.projectId, () => saveChannelTag(tag));
export const deleteChannelTagAction = async (projectId: number, tag: string) => run(projectId, () => deleteChannelTag(tag));
