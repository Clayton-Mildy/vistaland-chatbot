import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { pgCode } from '../db/pgError.js';
import {
  countActiveAdmins,
  createStaff,
  findStaffByEmail,
  findStaffById,
  getPublicStaff,
  listStaff,
  setStaffPassword,
  updateStaff,
} from '../repositories/staff.js';

const Role = z.enum(['admin', 'sales']);
const Password = z.string().min(12);

const VerifyBody = z.object({ email: z.string().min(1), password: z.string().min(1) });
const CreateBody = z.object({ email: z.email(), password: Password, displayName: z.string().trim().min(1), role: Role });
const PatchBody = z.object({
  displayName: z.string().trim().min(1).optional(),
  role: Role.optional(),
  isActive: z.boolean().optional(),
  password: Password.optional(),
});
const IdParams = z.object({ id: z.uuid() });

const isUniqueViolation = (err: unknown): boolean => pgCode(err) === '23505';

export async function staffRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/verify-credentials', { preHandler: [requireApiSecret] }, async (request, reply) => {
    const body = VerifyBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    const staff = await findStaffByEmail(body.data.email);
    // isActive matters here, or deactivating an account would not stop it signing in.
    if (!staff || !staff.isActive || !(await bcrypt.compare(body.data.password, staff.passwordHash))) {
      return reply.code(401).send({ data: null, error: 'UNAUTHORIZED' });
    }
    return reply.send({
      data: { id: staff.id, email: staff.email, displayName: staff.displayName, role: staff.role },
      error: null,
    });
  });

  app.get('/api/v1/staff', { preHandler: [requireApiSecret] }, async (_request, reply) => {
    return reply.send({ data: await listStaff(), error: null });
  });

  // The dashboard re-checks a signed-in account here, so deactivation ends sessions promptly.
  app.get('/api/v1/staff/:id', { preHandler: [requireApiSecret] }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
    const staff = await getPublicStaff(params.data.id);
    if (!staff) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
    return reply.send({ data: staff, error: null });
  });

  app.post('/api/v1/staff', { preHandler: [requireApiSecret] }, async (request, reply) => {
    const body = CreateBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    try {
      return reply.code(201).send({ data: await createStaff(body.data), error: null });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ data: null, error: 'EMAIL_TAKEN' });
      throw err;
    }
  });

  app.patch('/api/v1/staff/:id', { preHandler: [requireApiSecret] }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    const body = PatchBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ data: null, error: 'VALIDATION_ERROR' });
    const current = await findStaffById(params.data.id);
    if (!current) return reply.code(404).send({ data: null, error: 'NOT_FOUND' });
    const { password, ...patch } = body.data;
    // Deactivating or demoting the last active admin would leave nobody able to manage staff,
    // and the seed only creates an admin into an empty table.
    const losesAdmin = patch.isActive === false || (patch.role !== undefined && patch.role !== 'admin');
    if (current.role === 'admin' && current.isActive && losesAdmin && (await countActiveAdmins()) <= 1) {
      return reply.code(409).send({ data: null, error: 'LAST_ADMIN' });
    }
    if (password) await setStaffPassword(params.data.id, password);
    return reply.send({ data: await updateStaff(params.data.id, patch), error: null });
  });
}
