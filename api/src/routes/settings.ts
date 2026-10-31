import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { getAppSettings, updateAppSettings } from '../settings/appSettings.js';
import { currentPrompt, listPromptVersions, savePromptVersion } from '../repositories/promptVersions.js';

const SettingsPatch = z.object({
  aiEnabled: z.boolean().optional(),
  personaGroupName: z.string().trim().min(3).max(40).optional(),
  takeoverHours: z.number().int().min(1).max(168).optional(),
});

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  const opts = { preHandler: [requireApiSecret] };

  app.get('/api/v1/settings', opts, async (_req, reply) => reply.send({ data: await getAppSettings(), error: null }));

  app.put('/api/v1/settings', opts, async (req, reply) => {
    const body = SettingsPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    return reply.send({ data: await updateAppSettings(body.data), error: null });
  });

  // The FLOW MONI playbook. Saving creates a new version; the newest is the one in use.
  app.get('/api/v1/prompt-versions', opts, async (_req, reply) => {
    const versions = await listPromptVersions(10);
    return reply.send({ data: versions.length ? versions : [{ ...(await currentPrompt()), createdBy: null, createdAt: null }], error: null });
  });

  app.post('/api/v1/prompt-versions', opts, async (req, reply) => {
    const body = z.object({ text: z.string().trim().min(200).max(50_000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    const staff = z.uuid().safeParse(req.headers['x-staff-id']);
    return reply.code(201).send({ data: await savePromptVersion(body.data.text, staff.success ? staff.data : null), error: null });
  });
}
