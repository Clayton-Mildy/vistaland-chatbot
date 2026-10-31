import { apiFetch } from "./client";

export type GalleryHours = Partial<Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", [string, string] | null>>;

export type Project = {
  id: number;
  slug: string;
  displayName: string;
  personaTeamName: string;
  locationLabel: string | null;
  mapsUrl: string | null;
  accessNotes: string | null;
  galleryHours: GalleryHours | null;
  visitMinutes: number;
  sameDayMinNoticeMinutes: number;
  vlesProjectId: number;
  vlesAreaIds: number[];
  subsidiNotes: string | null;
  active: boolean;
};

export type ProjectPatch = Partial<Omit<Project, "id" | "slug" | "vlesProjectId">>;

export type TypeProfile = {
  houseTypeId: number;
  projectId: number;
  marketingName: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  highlights: string | null;
  active: boolean;
};

export type ProjectType = {
  houseTypeId: number;
  houseTypeName: string;
  salesCategory: string | null;
  totalUnits: number;
  availableUnits: number;
  profile: TypeProfile | null;
};

export const MATERIAL_KINDS = ["flyer", "video", "promo", "floor_plan", "brochure", "photo"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export const MATERIAL_LABEL: Record<MaterialKind, string> = {
  flyer: "Flyer",
  video: "Video",
  promo: "Promo",
  floor_plan: "Denah",
  brochure: "Brosur",
  photo: "Foto",
};

export type Material = {
  id: number;
  projectId: number;
  houseTypeId: number | null;
  kind: MaterialKind;
  url: string;
  mime: string;
  filename: string;
  validFrom: string | null;
  validTo: string | null;
  sort: number;
  active: boolean;
};
export type MaterialInput = Omit<Material, "id" | "active">;

export type ProjectPromo = {
  id: number;
  name: string;
  salesCategory: string | null;
  benefitType: string | null;
  benefitAmount: number | null;
  benefitPercent: number | null;
  validFrom: string | null;
  validTo: string | null;
  isUsable: boolean;
  customerText: string | null;
  termsText: string | null;
};

export type ChannelTag = { tag: string; projectId: number; channel: "instagram" | "facebook" | "tiktok" | "other"; contentKind: "promo" | "reels" | "general" };

const data = async <T>(p: Promise<{ data: T | null }>, fallback: T): Promise<T> => (await p).data ?? fallback;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const listProjects = () => data(apiFetch<Project[]>("/projects"), []);
export const updateProject = (id: number, patch: ProjectPatch) => apiFetch<Project>(`/projects/${id}`, json("PATCH", patch));
export const listProjectTypes = (id: number) => data(apiFetch<ProjectType[]>(`/projects/${id}/types`), []);
export const saveTypeProfile = (houseTypeId: number, body: Omit<TypeProfile, "houseTypeId">) =>
  apiFetch<TypeProfile>(`/type-profiles/${houseTypeId}`, json("PUT", body));
export const listMaterials = (projectId: number) => data(apiFetch<Material[]>(`/materials?projectId=${projectId}`), []);
export const createMaterial = (body: MaterialInput) => apiFetch<Material>("/materials", json("POST", body));
export const updateMaterial = (id: number, patch: Partial<MaterialInput> & { active?: boolean }) =>
  apiFetch<Material>(`/materials/${id}`, json("PATCH", patch));
export const deactivateMaterial = (id: number) => apiFetch<Material>(`/materials/${id}`, { method: "DELETE" });
export const listPromos = (projectId: number) => data(apiFetch<ProjectPromo[]>(`/promos?projectId=${projectId}`), []);
export const savePromoCopy = (id: number, customerText: string, termsText: string | null) =>
  apiFetch(`/promo-copy/${id}`, json("PUT", { customerText, termsText }));
export const listChannelTags = () => data(apiFetch<ChannelTag[]>("/channel-tags"), []);
export const saveChannelTag = (t: ChannelTag) =>
  apiFetch<ChannelTag>(`/channel-tags/${encodeURIComponent(t.tag)}`, json("PUT", { projectId: t.projectId, channel: t.channel, contentKind: t.contentKind }));
export const deleteChannelTag = (tag: string) => apiFetch(`/channel-tags/${encodeURIComponent(tag)}`, { method: "DELETE" });
