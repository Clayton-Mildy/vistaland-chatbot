import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { mkdirSync } from 'fs';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { MAX_MEDIA_BYTES, MediaError, mediaDir, saveUpload } from '../media/storage.js';

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const root = mediaDir();
  mkdirSync(root, { recursive: true });

  // Public: WhatsApp downloads materials from here. Names are random UUIDs.
  await app.register(fastifyStatic, { root, prefix: '/media/', decorateReply: false, dotfiles: 'deny' });
  await app.register(multipart, { limits: { fileSize: MAX_MEDIA_BYTES, files: 1 } });

  app.post('/api/v1/media', { preHandler: [requireApiSecret] }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    try {
      const saved = await saveUpload({ filename: file.filename, mimetype: file.mimetype, stream: file.file });
      return reply.code(201).send({ data: saved, error: null });
    } catch (err) {
      if (err instanceof MediaError) return reply.code(400).send({ data: null, error: err.code });
      throw err;
    }
  });
}
