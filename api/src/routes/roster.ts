import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { RosterError, addTimeOff, createAgent, deleteTimeOff, getAgent, listRoster, setAvailability, updateAgent } from '../scheduling/roster.js';

const bad = { data: null, error: 'VALIDATION_ERROR' };
const notFound = { data: null, error: 'NOT_FOUND' };

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const AvailabilityRow = z
  .object({ projectId: z.number().int().positive(), weekday: z.number().int().min(1).max(7), start: Time, end: Time })
  .refine((r) => r.start < r.end);
const Iso = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const AgentBody = z.object({
  name: z.string().trim().min(1),
  waPhone: z.string().trim().min(1),
  staffUserId: z.uuid().nullable().optional(),
  projectIds: z.array(z.number().int().positive()),
});
const AgentPatch = z
  .object({
    name: z.string().trim().min(1),
    waPhone: z.string().trim().min(1),
    staffUserId: z.uuid().nullable(),
    active: z.boolean(),
    projectIds: z.array(z.number().int().positive()),
  })
  .partial();
const AvailabilityBody = z.object({ rows: z.array(AvailabilityRow) });
const TimeOffBody = z
  .object({ startsAt: Iso, endsAt: Iso, reason: z.string().trim().nullish() })
  .refine((t) => t.endsAt > t.startsAt);

const UuidId = z.object({ id: z.uuid() });
const IntId = z.object({ id: z.coerce.number().int().positive() });

function rosterError(reply: FastifyReply, err: RosterError) {
  const body: { data: null; error: string; meta?: { count: number } } = { data: null, error: err.code };
  if (err.code === 'HAS_UPCOMING_VISITS') body.meta = { count: err.count ?? 0 };
  return reply.code(err.code === 'INVALID_PHONE' ? 400 : 409).send(body);
}

export async function rosterRoutes(app: FastifyInstance): Promise<void> {
  const opts = { preHandler: [requireApiSecret] };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof RosterError) return rosterError(reply, err);
    return reply.send(err);
  });

  app.get('/api/v1/roster', opts, async (_req, reply) => reply.send({ data: await listRoster(), error: null }));

  app.post('/api/v1/roster/agents', opts, async (req, reply) => {
    const body = AgentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(bad);
    const agent = await createAgent({ ...body.data, staffUserId: body.data.staffUserId ?? null });
    return reply.code(201).send({ data: agent, error: null });
  });

  app.patch('/api/v1/roster/agents/:id', opts, async (req, reply) => {
    const params = UuidId.safeParse(req.params);
    const body = AgentPatch.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(bad);
    const agent = await updateAgent(params.data.id, body.data);
    return agent ? reply.send({ data: agent, error: null }) : reply.code(404).send(notFound);
  });

  app.put('/api/v1/roster/agents/:id/availability', opts, async (req, reply) => {
    const params = UuidId.safeParse(req.params);
    const body = AvailabilityBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(bad);
    if (!(await getAgent(params.data.id))) return reply.code(404).send(notFound);
    await setAvailability(params.data.id, body.data.rows);
    return reply.send({ data: { saved: true }, error: null });
  });

  app.post('/api/v1/roster/agents/:id/time-off', opts, async (req, reply) => {
    const params = UuidId.safeParse(req.params);
    const body = TimeOffBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(bad);
    if (!(await getAgent(params.data.id))) return reply.code(404).send(notFound);
    const row = await addTimeOff(params.data.id, { ...body.data, reason: body.data.reason || null });
    return reply.code(201).send({ data: row, error: null });
  });

  app.delete('/api/v1/roster/time-off/:id', opts, async (req, reply) => {
    const params = IntId.safeParse(req.params);
    if (!params.success) return reply.code(400).send(bad);
    return (await deleteTimeOff(params.data.id)) ? reply.send({ data: { deleted: true }, error: null }) : reply.code(404).send(notFound);
  });
}
