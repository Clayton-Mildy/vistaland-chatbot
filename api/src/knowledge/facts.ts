import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { promoCopy, vlesPromos } from '../db/schema/index.js';
import { getProject, listProjects, type Project } from '../repositories/projects.js';
import { getKprAssumptions } from '../kpr/assumptions.js';
import { projectTypeOptions } from './units.js';
import { formatRupiahShort } from './format.js';

// The block of project facts injected into Moni's prompt each turn. Every amount here may be
// quoted to the customer, so it must come from VLES or from what staff entered.

const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

function galleryLine(hours: unknown): string | null {
  if (!hours || typeof hours !== 'object') return null;
  const h = hours as Record<string, [string, string] | null | undefined>;
  const label = (d: number) => {
    const v = h[String(d + 1)];
    if (v === undefined) return undefined;
    return v === null ? 'tutup' : `${v[0].replace(':', '.')}–${v[1].replace(':', '.')}`;
  };
  const groups: { from: number; to: number; text: string }[] = [];
  for (let d = 0; d < 7; d++) {
    const text = label(d);
    if (text === undefined) continue;
    const last = groups[groups.length - 1];
    if (last && last.text === text && last.to === d - 1) last.to = d;
    else groups.push({ from: d, to: d, text });
  }
  if (groups.length === 0) return null;
  return groups
    .map((g) => `${g.from === g.to ? DAYS[g.from] : `${DAYS[g.from]}–${DAYS[g.to]}`} ${g.text}`)
    .join(', ');
}

const range = (min: number | null, max: number | null) =>
  min === null ? '—' : max !== null && max !== min ? `${min}–${max}` : `${min}`;

async function projectBlock(project: Project): Promise<string> {
  const lines = [`PROYEK: ${project.displayName} (${project.personaTeamName})${project.locationLabel ? ` — ${project.locationLabel}` : ''}`];
  if (project.mapsUrl) lines.push(`Peta: ${project.mapsUrl}`);
  if (project.accessNotes) lines.push(`Akses: ${project.accessNotes}`);
  const gallery = galleryLine(project.galleryHours);
  if (gallery) lines.push(`Jam galeri: ${gallery}`);

  const types = await projectTypeOptions(project);
  if (types.length > 0) {
    lines.push('Tipe tersedia:');
    for (const t of types) {
      const name = t.marketingName && t.marketingName !== t.name ? `${t.name} "${t.marketingName}"` : t.name;
      const rooms = t.bedrooms !== null ? `, ${t.bedrooms} KT` : '';
      const scheme = t.fromKprSchemePrice !== null ? ` (skema KPR mulai ${formatRupiahShort(t.fromKprSchemePrice)})` : '';
      lines.push(
        `- ${name} (id ${t.houseTypeId}${rooms}) LT ${range(t.landSizeMin, t.landSizeMax)} / LB ${t.buildingSize ?? '—'} m² — ${t.availableUnits} unit — mulai ${formatRupiahShort(t.fromPrice)}${scheme}`
      );
    }
  } else {
    lines.push('Tipe tersedia: belum ada unit yang dijual saat ini.');
  }

  // Promos of the VLES project that fit a sales category this project actually sells.
  const categories = new Set(types.map((t) => t.salesCategory?.toLowerCase()).filter(Boolean));
  const promos = (
    await getDb()
      .select({ promo: vlesPromos, copy: promoCopy })
      .from(vlesPromos)
      .leftJoin(promoCopy, eq(promoCopy.vlesPromoId, vlesPromos.id))
      .where(and(eq(vlesPromos.projectId, project.vlesProjectId), eq(vlesPromos.deleted, false), eq(vlesPromos.isUsable, true)))
      .orderBy(vlesPromos.name)
  ).filter(({ promo }) => !promo.salesCategory || categories.has(promo.salesCategory.toLowerCase()));
  if (promos.length > 0) {
    lines.push('Promo berlaku:');
    for (const { promo, copy } of promos) {
      const label = (promo.raw as { benefit_type?: { label?: string } } | null)?.benefit_type?.label ?? null;
      const value =
        promo.benefitAmount !== null ? formatRupiahShort(promo.benefitAmount) : promo.benefitPercent !== null ? `${promo.benefitPercent}%` : null;
      const benefit = [label, value].filter(Boolean).join(' ');
      let line = `- ${promo.name}${benefit ? `: ${benefit}` : ''}`;
      if (copy?.customerText) line += `. ${copy.customerText}`;
      if (copy?.termsText) line += ` (S&K: ${copy.termsText})`;
      lines.push(line);
    }
  }

  if (project.subsidiNotes) lines.push(`Catatan subsidi: ${project.subsidiNotes}`);

  const a = await getKprAssumptions(project.id);
  if (a) {
    lines.push(
      `Asumsi KPR: bunga tetap ${a.fixedRatePct}% ${a.fixedYears} tahun, lalu ${a.floatingRatePct}%; tenor ${a.tenorOptions.join('/')} tahun; DP ${a.dpOptionsPct.join('/')}%`
    );
  }
  return lines.join('\n');
}

export async function buildProjectFacts(projectId: number | null, _today: string): Promise<string> {
  if (projectId !== null) {
    const project = await getProject(projectId);
    if (project) return projectBlock(project);
  }
  const lines = ['PROYEK: belum diketahui. Proyek yang tersedia:'];
  for (const p of (await listProjects()).filter((x) => x.active)) {
    const types = await projectTypeOptions(p);
    const units = types.reduce((n, t) => n + t.availableUnits, 0);
    const from = types.length > 0 ? Math.min(...types.map((t) => t.fromPrice)) : null;
    const stock = units > 0 && from !== null ? `${units} unit tersedia, mulai ${formatRupiahShort(from)}` : 'belum ada unit tersedia';
    lines.push(`- ${p.displayName} (${p.personaTeamName})${p.locationLabel ? ` — ${p.locationLabel}` : ''}: ${stock}`);
  }
  return lines.join('\n');
}

