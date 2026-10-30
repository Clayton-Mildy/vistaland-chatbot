import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireApiSecret } from '../middleware/apiSecret.js';
import {
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
}
