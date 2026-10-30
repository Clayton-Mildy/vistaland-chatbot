import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { getConfig } from '../config.js';

/**
 * preHandler for every /api/v1 route. The only caller is the dashboard's server, which sends
 * API_SECRET_KEY as a bearer token; browsers never reach /api/v1 (Caddy does not route it).
 */
export async function requireApiSecret(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization ?? '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(getConfig().API_SECRET_KEY);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    await reply.code(401).send({ data: null, error: 'UNAUTHORIZED' });
  }
}
