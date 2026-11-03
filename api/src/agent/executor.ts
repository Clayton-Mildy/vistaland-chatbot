import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { vlesUnits, type MaterialKind } from '../db/schema/index.js';
import type { VlesClient } from '../vles/client.js';
import { listProjects, type Project } from '../repositories/projects.js';
import { activeMaterials } from '../repositories/materials.js';
import { findProjectBySlug, getTypeDetails, searchUnits } from '../knowledge/units.js';
import { checkAvailability } from '../knowledge/availability.js';
import { simulateForType } from '../knowledge/simulation.js';
import {
  StageError,
  getLead,
  listEvents,
  optOut,
  setLeadProject,
  setLeadStage,
  updateLeadFacts,
  type LeadFactsPatch,
} from '../leads/repository.js';
import type { Alerts } from '../notify/alerts.js';
import { MAX_RANGE_DAYS, freeSlots, loadSlotData, pickSlots } from '../scheduling/slots.js';
import { addDays, atWib } from '../scheduling/time.js';
import {
  activeVisitForLead,
  bookVisit,
  cancelVisit,
  rescheduleVisit,
  type VisitError,
  type VisitResult,
  type VisitView,
} from '../scheduling/visits.js';
import { collectAmounts } from './rupiah.js';
import type { ReplyEvidence } from './replyChecks.js';
import { TOOL_INPUTS, type ToolName } from './tools.js';
import type { z } from 'zod';

export type QueuedMaterial = { materialId: number; kind: MaterialKind; url: string; mime: string; filename: string };

/** What a simulate_kpr call produced; recorded as simulation_sent once the reply goes out. */
export type SimulationRecord = {
  typeName: string;
  schemeName: string | null;
  price: number;
  dpPct: number;
  tenorYears: number;
  fixedYears: number;
  monthlyFixed: number;
  monthlyAfterFixed: number | null;
};

/** One turn's working state, filled in by the tools. */
export type TurnContext = {
  leadId: string;
  contactId: string;
  projectId: number | null;
  vles: VlesClient | null;
  today: string;
  now: Date;
  // A test-chat contact: its visits are test visits that block nothing and alert no one.
  isTest: boolean;
  alerts: Alerts | null;
  queuedMaterials: QueuedMaterial[];
  evidence: ReplyEvidence;
  handoffReason: string | null;
  simulations: SimulationRecord[];
};

export function newTurnContext(input: {
  leadId: string;
  contactId: string;
  projectId: number | null;
  vles: VlesClient | null;
  today: string;
  subsidiNotes: string | null;
  now: Date;
  isTest: boolean;
  alerts: Alerts | null;
  activeVisit: VisitView | null;
}): TurnContext {
  return {
    leadId: input.leadId,
    contactId: input.contactId,
    projectId: input.projectId,
    vles: input.vles,
    today: input.today,
    now: input.now,
    isTest: input.isTest,
    alerts: input.alerts,
    queuedMaterials: [],
    evidence: {
      knownAmounts: [],
      toolsCalled: new Set(),
      verifiedUnitNumbers: [],
      subsidiNotes: input.subsidiNotes,
      visitBooked: input.activeVisit !== null,
      salesNames: input.activeVisit ? [input.activeVisit.salesName] : [],
    },
    handoffReason: null,
    simulations: [],
  };
}

class ToolError extends Error {}

// How many materials of a kind one call sends: the latest flyer is enough, a few photos help.
const PER_CALL: Record<MaterialKind, number> = { flyer: 1, video: 1, promo: 1, floor_plan: 1, brochure: 1, photo: 3 };

async function resolveProject(slug: string): Promise<Project> {
  const p = await findProjectBySlug(slug);
  if (p && p.active) return p;
  const valid = (await listProjects()).filter((x) => x.active).map((x) => x.slug);
  throw new ToolError(`Proyek "${slug}" tidak dikenal. Pilihan: ${valid.join(', ')}.`);
}

async function typeName(houseTypeId: number): Promise<string> {
  const [row] = await getDb().select({ name: vlesUnits.houseTypeName }).from(vlesUnits).where(eq(vlesUnits.houseTypeId, houseTypeId)).limit(1);
  return row?.name ?? `tipe ${houseTypeId}`;
}

const HANDOFF_VISIT = 'Simpan hari dan jam yang diminta konsumen dengan update_lead (timeline), lalu handoff_to_human dengan reason "jadwal kunjungan".';
const SLOT_GONE = 'Jam ini baru saja terisi; tawarkan jam lain dari find_visit_slots.';
const VISIT_ERRORS: Record<VisitError | 'NO_ACTIVE_VISIT', string> = {
  SLOT_TAKEN: SLOT_GONE,
  SLOT_NOT_FREE: SLOT_GONE,
  HAS_ACTIVE_VISIT: 'Konsumen sudah punya kunjungan aktif (lihat STATUS LEAD); pakai reschedule_visit untuk mengubahnya.',
  NO_ACTIVE_VISIT: 'Konsumen belum punya kunjungan aktif; pakai book_visit.',
  NOT_FOUND: 'Kunjungan ini sudah tidak aktif.',
  NOT_ACTIVE: 'Kunjungan ini sudah tidak aktif.',
  AGENT_NOT_FREE: SLOT_GONE,
  TOO_EARLY: 'Kunjungan belum bisa diubah sekarang.',
};

/** A booked or moved visit: the result Moni sees, and the evidence and alert that go with it. */
async function visitOutcome(r: VisitResult, ctx: TurnContext) {
  if (!r.ok) return { error: r.error, message: VISIT_ERRORS[r.error] };
  ctx.evidence.visitBooked = true;
  ctx.evidence.salesNames.push(r.visit.salesName);
  await ctx.alerts?.visitChanged(r.change);
  return { ok: true, visit_id: r.visit.id, label: r.visit.label, sales_name: r.visit.salesName, maps_url: r.visit.mapsUrl };
}

type Inputs = { [K in ToolName]: z.infer<(typeof TOOL_INPUTS)[K]> };
type Handlers = { [K in Exclude<ToolName, 'respond_to_customer'>]: (input: Inputs[K], ctx: TurnContext) => Promise<unknown> };

const handlers: Handlers = {
  async search_units(i, ctx) {
    const p = await resolveProject(i.project);
    const r = await searchUnits({ projectId: p.id, bedrooms: i.bedrooms, maxPrice: i.max_price, maxMonthly: i.max_monthly, salesCategory: i.sales_category });
    // Only results with stock in them back a claim about stock.
    if (r.types.length > 0) ctx.evidence.toolsCalled.add('search_units');
    return r;
  },

  async get_type_details(i) {
    const p = await resolveProject(i.project);
    const d = await getTypeDetails(p.id, i.house_type_id);
    return d ?? { error: 'NOT_FOUND', message: 'Tipe ini tidak ditemukan atau tidak ada unit yang sedang dijual.' };
  },

  async check_availability(i, ctx) {
    const p = await resolveProject(i.project);
    const r = await checkAvailability(ctx.vles, { projectId: p.id, houseTypeId: i.house_type_id, facing: i.facing });
    if (r.verified) {
      ctx.evidence.toolsCalled.add('check_availability');
      ctx.evidence.verifiedUnitNumbers.push(...r.units.map((u) => u.unitNumber));
    } else if (ctx.alerts) {
      // Moni tells the customer the team will check; this makes sure someone does.
      await ctx.alerts.availabilityUnverified(ctx.leadId, p.id, await typeName(i.house_type_id));
    }
    return r;
  },

  async simulate_kpr(i, ctx) {
    const p = await resolveProject(i.project);
    const r = await simulateForType({ projectId: p.id, houseTypeId: i.house_type_id, dpPct: i.dp_pct, dpAmount: i.dp_amount, tenorYears: i.tenor_years });
    if ('error' in r) {
      const message = r.error === 'NO_KPR_SETTINGS' ? 'Asumsi KPR proyek ini belum diatur tim; jangan menghitung sendiri.' : 'Tipe ini tidak punya harga yang bisa disimulasikan.';
      return { error: r.error, message };
    }
    const name = await typeName(i.house_type_id);
    for (const s of r.simulations) {
      ctx.simulations.push({ typeName: name, schemeName: r.schemeName, price: s.price, dpPct: s.dpPct, tenorYears: s.tenorYears, fixedYears: s.fixedYears, monthlyFixed: s.monthlyFixed, monthlyAfterFixed: s.monthlyAfterFixed });
    }
    return r;
  },

  async send_materials(i, ctx) {
    const p = await resolveProject(i.project);
    const rows = (await activeMaterials(p.id, i.kind, i.house_type_id ?? null, ctx.today)).slice(0, PER_CALL[i.kind]);
    const sent = new Set(
      (await listEvents(ctx.leadId, ['material_sent'])).map((e) => (e.payload as { materialId?: number }).materialId)
    );
    const queued: { kind: MaterialKind; filename: string }[] = [];
    const alreadySent: string[] = [];
    for (const m of rows) {
      if (ctx.queuedMaterials.some((q) => q.materialId === m.id)) continue;
      if (sent.has(m.id) && !i.resend) {
        alreadySent.push(m.filename);
        continue;
      }
      ctx.queuedMaterials.push({ materialId: m.id, kind: m.kind, url: m.url, mime: m.mime, filename: m.filename });
      queued.push({ kind: m.kind, filename: m.filename });
    }
    return { queued, already_sent: alreadySent, missing: rows.length === 0 };
  },

  async update_lead(i, ctx) {
    if (i.project) {
      const p = await resolveProject(i.project);
      await setLeadProject(ctx.leadId, p.id, 'moni');
      ctx.projectId = p.id;
    }
    const patch: LeadFactsPatch = {
      name: i.name,
      budgetPrice: i.budget_price,
      budgetMonthly: i.budget_monthly,
      dpBudget: i.dp_budget,
      bedroomsWanted: i.bedrooms_wanted,
      purpose: i.purpose,
      timeline: i.timeline,
      domicileArea: i.domicile_area,
      addConcerns: i.add_concerns,
      addTypeInterest: i.add_type_interest,
      hotCold: i.hot_cold,
      lostReason: i.lost_reason,
    };
    let lead = await updateLeadFacts(ctx.leadId, patch, 'moni');
    // Moni may repeat the customer's own budget back to them ("budget Rp450 jt ya").
    for (const v of [i.budget_price, i.budget_monthly, i.dp_budget]) if (v !== undefined) ctx.evidence.knownAmounts.push(v);
    if (i.stage) {
      try {
        lead = await setLeadStage(ctx.leadId, i.stage, 'moni');
      } catch (err) {
        if (err instanceof StageError) throw new ToolError(`Data tersimpan, tetapi tahap tidak bisa diubah dari ${lead.stage} ke ${i.stage}.`);
        throw err;
      }
    }
    return { ok: true, stage: lead.stage };
  },

  async find_visit_slots(i, ctx) {
    const p = await resolveProject(i.project);
    const last = addDays(i.date_from, MAX_RANGE_DAYS - 1);
    const to = i.date_to ?? i.date_from;
    if (to < i.date_from) throw new ToolError('date_to tidak boleh sebelum date_from.');
    const range = { from: i.date_from, to: to > last ? last : to };
    const data = await loadSlotData(p.id, range.from, range.to);
    if (!data) throw new ToolError(`Proyek "${i.project}" tidak dikenal.`);
    if (!Object.values(data.project.galleryHours ?? {}).some(Boolean)) {
      return { slots: [], reason: 'NO_GALLERY_HOURS', message: `Jam galeri proyek ini belum diatur. ${HANDOFF_VISIT}` };
    }
    if (data.agents.length === 0) {
      return { slots: [], reason: 'NO_ROSTER', message: `Belum ada sales yang bertugas di proyek ini. ${HANDOFF_VISIT}` };
    }
    const slots = pickSlots(freeSlots(data, range, ctx.now), { partOfDay: i.part_of_day, time: i.time });
    if (slots.length === 0) {
      return { slots: [], reason: 'NONE_FREE', message: 'Tidak ada jam kosong pada tanggal ini; tawarkan hari lain dan cari lagi.' };
    }
    return { slots: slots.map((s) => ({ date: s.date, time: s.time, label: s.label })) };
  },

  async book_visit(i, ctx) {
    const p = await resolveProject(i.project);
    const typeInterest = i.type_interest ?? (await getLead(ctx.leadId))?.typeInterest ?? [];
    const r = await bookVisit(
      { leadId: ctx.leadId, projectId: p.id, startsAt: atWib(i.date, i.time), typeInterest, topics: i.topics ?? null, actor: 'moni', isTest: ctx.isTest },
      ctx.now
    );
    return visitOutcome(r, ctx);
  },

  async reschedule_visit(i, ctx) {
    const active = await activeVisitForLead(ctx.leadId);
    if (!active) return { error: 'NO_ACTIVE_VISIT', message: VISIT_ERRORS.NO_ACTIVE_VISIT };
    return visitOutcome(await rescheduleVisit({ visitId: active.id, startsAt: atWib(i.date, i.time), actor: 'moni' }, ctx.now), ctx);
  },

  async cancel_visit(i, ctx) {
    const active = await activeVisitForLead(ctx.leadId);
    if (!active) return { error: 'NO_ACTIVE_VISIT' };
    const r = await cancelVisit({ visitId: active.id, reason: i.reason, actor: 'moni' }, ctx.now);
    if (!r.ok) return { error: r.error };
    ctx.evidence.visitBooked = false;
    await ctx.alerts?.visitChanged(r.change);
    return { ok: true };
  },

  async handoff_to_human(i, ctx) {
    ctx.handoffReason = i.reason;
    return { ok: true, note: 'Tim sales akan melanjutkan percakapan ini. Kirim pesan singkat ke konsumen.' };
  },

  async opt_out(_i, ctx) {
    await optOut(ctx.contactId, ctx.leadId, 'moni');
    return { ok: true };
  },
};

const fail = (message: string) => ({ content: JSON.stringify({ error: message }), isError: true });

/** Runs one tool call. Never throws for bad input or a known refusal: the model gets an error result. */
export async function runTool(name: string, input: unknown, ctx: TurnContext): Promise<{ content: string; isError: boolean }> {
  if (!(name in handlers)) return fail(`Alat "${name}" tidak dikenal.`);
  const schema = TOOL_INPUTS[name as ToolName];
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    return fail(`Input tidak valid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`).join('; ')}`);
  }
  try {
    const handler = handlers[name as keyof Handlers] as (input: unknown, ctx: TurnContext) => Promise<unknown>;
    const result = await handler(parsed.data, ctx);
    ctx.evidence.knownAmounts.push(...collectAmounts(result));
    return { content: JSON.stringify(result), isError: false };
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message);
    console.error(`[agent] tool ${name} failed:`, err instanceof Error ? err.message : err);
    return fail('Alat sedang bermasalah. Jangan menebak; tawarkan bantuan tim jika perlu.');
  }
}
