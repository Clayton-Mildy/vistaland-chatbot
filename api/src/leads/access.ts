import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { findStaffById } from '../repositories/staff.js';
import { agentForStaff } from '../scheduling/roster.js';
import type { Visit } from '../scheduling/visits.js';
import type { Lead } from './repository.js';

export type StaffScope =
  | { staffUserId: string; role: 'admin' }
  | { staffUserId: string; role: 'sales'; salesAgentId: string | null };

/**
 * The staff member acting, from the dashboard's X-Staff-Id header; null when it is missing, is not
 * a uuid, or names an unknown or inactive account.
 */
export async function resolveScope(req: FastifyRequest): Promise<StaffScope | null> {
  const id = z.uuid().safeParse(req.headers['x-staff-id']);
  if (!id.success) return null;
  const staff = await findStaffById(id.data);
  if (!staff || !staff.isActive) return null;
  if (staff.role === 'admin') return { staffUserId: staff.id, role: 'admin' };
  return { staffUserId: staff.id, role: 'sales', salesAgentId: (await agentForStaff(staff.id))?.id ?? null };
}

/** Admins see every lead; a sales person sees only the leads assigned to their own agent. */
export function leadVisible(scope: StaffScope, lead: Pick<Lead, 'assignedSalesId'>): boolean {
  if (scope.role === 'admin') return true;
  return scope.salesAgentId !== null && lead.assignedSalesId === scope.salesAgentId;
}

export function visitVisible(scope: StaffScope, visit: Pick<Visit, 'salesAgentId'>): boolean {
  if (scope.role === 'admin') return true;
  return scope.salesAgentId !== null && visit.salesAgentId === scope.salesAgentId;
}
