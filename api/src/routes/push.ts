import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { findStaffById } from '../repositories/staff.js';
import { deleteSubscription, saveSubscription } from '../notify/push.js';

const SubscriptionBody = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
const DeleteBody = z.object({ endpoint: z.string().min(1) });

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  const opts = { preHandler: [requireApiSecret] };

  // The browser needs the public VAPID key to subscribe; null means push is off.
  app.get('/api/v1/push/config', opts, async (_req, reply) => {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = getConfig();
    return reply.send({ data: { publicKey: VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY ? VAPID_PUBLIC_KEY : null }, error: null });
  });

  app.post('/api/v1/push/subscriptions', opts, async (req, reply) => {
    // The dashboard's server vouches for the signed-in account with X-Staff-Id.
    const staffId = z.uuid().safeParse(req.headers['x-staff-id']);
    const staff = staffId.success ? await findStaffById(staffId.data) : null;
    if (!staff || !staff.isActive) return reply.code(401).send({ data: null, error: 'UNAUTHORIZED' });
    const body = SubscriptionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    await saveSubscription(staff.id, body.data);
    return reply.send({ data: { ok: true }, error: null });
  });

  app.delete('/api/v1/push/subscriptions', opts, async (req, reply) => {
    const body = DeleteBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    await deleteSubscription(body.data.endpoint);
    return reply.send({ data: { ok: true }, error: null });
  });
}
