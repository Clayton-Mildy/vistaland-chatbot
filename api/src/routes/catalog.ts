import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { MATERIAL_KINDS } from '../db/schema/index.js';
import { getProject, listProjects, updateProject } from '../repositories/projects.js';
import { listProjectTypes, upsertTypeProfile } from '../repositories/typeProfiles.js';
import { createMaterial, listMaterials, updateMaterial } from '../repositories/materials.js';
import { listProjectPromos, upsertPromoCopy } from '../repositories/promoCopy.js';
import { TAG_PATTERN, deleteChannelTag, listChannelTags, upsertChannelTag } from '../repositories/channelTags.js';

const bad = { data: null, error: 'VALIDATION_ERROR' };
const notFound = { data: null, error: 'NOT_FOUND' };

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
// ISO weekday ("1" = Monday ... "7" = Sunday) -> [open, close], or null when closed.
const GalleryHours = z.partialRecord(z.enum(['1', '2', '3', '4', '5', '6', '7']), z.tuple([Time, Time]).nullable());
const NullableText = z.string().trim().nullable();

const ProjectPatch = z
  .object({
    displayName: z.string().trim().min(1),
    personaTeamName: z.string().trim().min(1),
    locationLabel: NullableText,
    mapsUrl: z.url().nullable(),
    accessNotes: NullableText,
    galleryHours: GalleryHours.nullable(),
    visitMinutes: z.number().int().min(15).max(480),
    sameDayMinNoticeMinutes: z.number().int().min(0).max(1440),
    vlesAreaIds: z.array(z.number().int().positive()),
    subsidiNotes: NullableText,
    active: z.boolean(),
  })
  .partial();

const TypeProfileBody = z.object({
  projectId: z.number().int().positive(),
  marketingName: NullableText.optional(),
  bedrooms: z.number().int().min(0).max(10).nullable().optional(),
  bathrooms: z.number().int().min(0).max(10).nullable().optional(),
  floors: z.number().int().min(1).max(5).nullable().optional(),
  highlights: NullableText.optional(),
  active: z.boolean().optional(),
});

const IsoDate = z.iso.date();
const MaterialBody = z.object({
  projectId: z.number().int().positive(),
  houseTypeId: z.number().int().positive().nullable().optional(),
  kind: z.enum(MATERIAL_KINDS),
  url: z.url(),
  mime: z.string().min(1),
  filename: z.string().min(1),
  validFrom: IsoDate.nullable().optional(),
  validTo: IsoDate.nullable().optional(),
  sort: z.number().int().optional(),
});
const MaterialPatch = MaterialBody.omit({ projectId: true }).partial().extend({ active: z.boolean().optional() });

const PromoCopyBody = z.object({ customerText: z.string().trim().min(1), termsText: NullableText.optional() });
const TagBody = z.object({
  projectId: z.number().int().positive(),
  channel: z.enum(['instagram', 'facebook', 'tiktok', 'other']),
  contentKind: z.enum(['promo', 'reels', 'general']),
});

const IntId = z.object({ id: z.coerce.number().int().positive() });
const ProjectQuery = z.object({ projectId: z.coerce.number().int().positive() });

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const opts = { preHandler: [requireApiSecret] };

  app.get('/api/v1/projects', opts, async (_req, reply) => reply.send({ data: await listProjects(), error: null }));

  app.patch('/api/v1/projects/:id', opts, async (req, reply) => {
    const params = IntId.safeParse(req.params);
    const body = ProjectPatch.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(bad);
    const row = await updateProject(params.data.id, body.data);
    return row ? reply.send({ data: row, error: null }) : reply.code(404).send(notFound);
  });

  app.get('/api/v1/projects/:id/types', opts, async (req, reply) => {
    const params = IntId.safeParse(req.params);
    if (!params.success) return reply.code(400).send(bad);
    const project = await getProject(params.data.id);
    if (!project) return reply.code(404).send(notFound);
    return reply.send({ data: await listProjectTypes(project), error: null });
  });

  app.put('/api/v1/type-profiles/:id', opts, async (req, reply) => {
    const params = IntId.safeParse(req.params);
    const body = TypeProfileBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(bad);
    return reply.send({ data: await upsertTypeProfile(params.data.id, body.data), error: null });
  });

  app.get('/api/v1/materials', opts, async (req, reply) => {
    const q = ProjectQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    return reply.send({ data: await listMaterials(q.data.projectId), error: null });
  });

  app.post('/api/v1/materials', opts, async (req, reply) => {
    const body = MaterialBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(bad);
    return reply.code(201).send({ data: await createMaterial(body.data), error: null });
  });

  app.patch('/api/v1/materials/:id', opts, async (req, reply) => {
    const params = IntId.safeParse(req.params);
    const body = MaterialPatch.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(bad);
    const row = await updateMaterial(params.data.id, body.data);
    return row ? reply.send({ data: row, error: null }) : reply.code(404).send(notFound);
  });

  // Soft delete: lead history keeps pointing at what was sent.
  app.delete('/api/v1/materials/:id', opts, async (req, reply) => {
    const params = IntId.safeParse(req.params);
    if (!params.success) return reply.code(400).send(bad);
    const row = await updateMaterial(params.data.id, { active: false });
    return row ? reply.send({ data: row, error: null }) : reply.code(404).send(notFound);
  });

  app.get('/api/v1/promos', opts, async (req, reply) => {
    const q = ProjectQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const project = await getProject(q.data.projectId);
    if (!project) return reply.code(404).send(notFound);
    return reply.send({ data: await listProjectPromos(project), error: null });
  });

  app.put('/api/v1/promo-copy/:id', opts, async (req, reply) => {
    const params = IntId.safeParse(req.params);
    const body = PromoCopyBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(bad);
    return reply.send({ data: await upsertPromoCopy(params.data.id, body.data.customerText, body.data.termsText ?? null), error: null });
  });

  app.get('/api/v1/channel-tags', opts, async (_req, reply) => reply.send({ data: await listChannelTags(), error: null }));

  app.put('/api/v1/channel-tags/:tag', opts, async (req, reply) => {
    const tag = String((req.params as { tag: string }).tag).toUpperCase();
    const body = TagBody.safeParse(req.body);
    if (!TAG_PATTERN.test(tag) || !body.success) return reply.code(400).send(bad);
    return reply.send({ data: await upsertChannelTag({ tag, ...body.data }), error: null });
  });

  app.delete('/api/v1/channel-tags/:tag', opts, async (req, reply) => {
    await deleteChannelTag(String((req.params as { tag: string }).tag));
    return reply.send({ data: { deleted: true }, error: null });
  });
}
