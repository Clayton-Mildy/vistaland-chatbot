import { apiFetch } from "./client";

export type SyncState = {
  endpoint: string;
  lastServerTime: string | null;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
};

export type TypeStock = {
  houseTypeId: number;
  houseTypeName: string;
  salesCategory: string | null;
  landSizeMin: number | null;
  landSizeMax: number | null;
  buildingSize: number | null;
  availableUnits: number;
  totalUnits: number;
  minPrice: number | null;
  maxPrice: number | null;
  unpricedAvailable: number;
  outOfPeriodAvailable: number;
};

export type ProjectStock = {
  projectId: number;
  slug: string;
  displayName: string;
  availableUnits: number;
  totalUnits: number;
  types: TypeStock[];
};

export type StockSummary = {
  projects: ProjectStock[];
  unassignedAreas: { vlesProjectId: number; areaId: number; areaName: string; units: number; availableUnits: number }[];
  syncStates: SyncState[];
  stale: boolean;
};

export async function getStock(): Promise<StockSummary> {
  const res = await apiFetch<StockSummary>("/stock");
  if (!res.data) throw new Error("Empty stock response");
  return res.data;
}
