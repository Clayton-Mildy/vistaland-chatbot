import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { vlesMortgageBanks } from '../db/schema/index.js';
import { getProject } from '../repositories/projects.js';
import { parseDpFromSchemeName } from '../kpr/calculator.js';
import {
  getSchemeDpOverride,
  listKprSettings,
  listSchemeDpOverrides,
  setSchemeDpOverride,
  upsertKprSettings,
} from '../kpr/assumptions.js';

const Rate = z.number().min(0).max(30);
const SettingsBody = z.object({
  projectId: z.number().int().positive(),
  bankId: z.number().int().positive().nullable(),
  fixedRatePct: Rate,
  fixedYears: z.number().int().min(0).max(30),
  floatingRatePct: Rate,
  tenorOptions: z.array(z.number().int().min(1).max(30)).min(1),
  dpOptionsPct: z.array(z.number().min(0).max(100)).min(1),
  notes: z.string().nullable().optional(),
});
const ProjectQuery = z.object({ projectId: z.coerce.number().int().positive() });
const OverrideBody = z.object({ schemeName: z.string().trim().min(1), dpPct: z.number().min(0).max(100) });

export async function kprRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/kpr-settings', { preHandler: [requireApiSecret] }, async (request, reply) => {
    const q = ProjectQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    return reply.send({ data: await listKprSettings(q.data.projectId), error: null });
  });

  app.put('/api/v1/kpr-settings', { preHandler: [requireApiSecret] }, async (request, reply) => {
    const body = SettingsBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    return reply.send({ data: await upsertKprSettings({ ...body.data, notes: body.data.notes ?? null }), error: null });
  });

  app.get('/api/v1/scheme-dp-overrides', { preHandler: [requireApiSecret] }, async (_request, reply) => {
    return reply.send({ data: await listSchemeDpOverrides(), error: null });
  });

  app.put('/api/v1/scheme-dp-overrides', { preHandler: [requireApiSecret] }, async (request, reply) => {
    const body = OverrideBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    await setSchemeDpOverride(body.data.schemeName, body.data.dpPct);
    return reply.send({ data: body.data, error: null });
  });

  // Banks VLES lists for the project, for per-bank KPR rows.
  app.get('/api/v1/mortgage-banks', { preHandler: [requireApiSecret] }, async (request, reply) => {
    const q = ProjectQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    const project = await getProject(q.data.projectId);
    if (!project) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
    const rows = await getDb()
      .selectDistinctOn([vlesMortgageBanks.bankId], { bankId: vlesMortgageBanks.bankId, bankName: vlesMortgageBanks.bankName, branchName: vlesMortgageBanks.branchName })
      .from(vlesMortgageBanks)
      .where(and(eq(vlesMortgageBanks.projectId, project.vlesProjectId), eq(vlesMortgageBanks.deleted, false), sql`${vlesMortgageBanks.bankId} is not null`))
      .orderBy(asc(vlesMortgageBanks.bankId));
    return reply.send({ data: rows, error: null });
  });

  // Every VLES payment scheme name in use, with the DP read from its name and any override.
  app.get('/api/v1/scheme-names', { preHandler: [requireApiSecret] }, async (_request, reply) => {
    const rows = (
      await getDb().execute<{ name: string; units: number }>(sql`
        select name, count(distinct unit_id)::int as units from vles_unit_schemes group by name order by name
      `)
    ).rows;
    const data = [];
    for (const r of rows) {
      data.push({ name: r.name, units: r.units, parsedDpPct: parseDpFromSchemeName(r.name), overrideDpPct: await getSchemeDpOverride(r.name) });
    }
    return reply.send({ data, error: null });
  });
}
