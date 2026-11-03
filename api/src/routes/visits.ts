import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { getDb } from '../db/client.js';
import { contacts, leads } from '../db/schema/index.js';
import type { ChakraClient } from '../chakra/client.js';
import type { Alerts } from '../notify/alerts.js';
import { visitVisible, resolveScope, type StaffScope } from '../leads/access.js';
import { getContact, getConversationByContact, getLead } from '../leads/repository.js';
import { sendStaffText } from '../leads/staffMessage.js';
import { loadHandoverSummary } from '../leads/summary.js';
import { enqueue, outboundSummary } from '../outbound/repository.js';
import { freeSlots, loadSlotData } from '../scheduling/slots.js';
import { addDays, atWib } from '../scheduling/time.js';
import {
  cancelVisit,
  getVisitView,
  listVisitViews,
  markOutcome,
  reassignVisit,
  rescheduleVisit,
  type VisitError,
  type VisitResult,
  type VisitView,
} from '../scheduling/visits.js';

const bad = { data: null, error: 'VALIDATION_ERROR' };
const notFound = { data: null, error: 'NOT_FOUND' };
const staffRequired = { data: null, error: 'STAFF_REQUIRED' };
const forbidden = { data: null, error: 'FORBIDDEN' };

const MAX_RANGE_DAYS = 31;
const WINDOW_MS = 24 * 60 * 60 * 1000;

const IsoDate = z.iso.date();
const IdParams = z.object({ id: z.uuid() });
const ListQuery = z.object({
  from: IsoDate,
  to: IsoDate,
  projectId: z.coerce.number().int().positive().optional(),
  salesAgentId: z.uuid().optional(),
});
const MoveBody = z.object({ date: IsoDate, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) });
const ReassignBody = z.object({ salesAgentId: z.uuid() });
const CancelBody = z.object({ reason: z.string().trim().min(1).max(500) });
const OutcomeBody = z.object({ outcome: z.enum(['visited', 'no_show']) });

const actorOf = (scope: StaffScope) => `staff:${scope.staffUserId}`;
const failure = (error: VisitError) => ({ status: error === 'NOT_FOUND' ? 404 : 409, body: { data: null, error } });

export function visitRoutes(deps: { chakra?: ChakraClient; alerts: Alerts | null; now?: () => Date }) {
  const clock = () => (deps.now ?? (() => new Date()))();

  /**
   * Tells the customer who their sales person is now, unless they are a test contact or opted out.
   * Free text needs a recent customer message and a working ChakraHQ; otherwise the template is
   * queued, so the notice is not lost.
   */
  async function noticeReassignment(visit: VisitView, scope: StaffScope, req: FastifyRequest, now: Date): Promise<'sent' | 'queued' | 'none'> {
    const lead = await getLead(visit.leadId);
    const contact = lead ? await getContact(lead.contactId) : null;
    if (!lead || !contact || contact.isTest || contact.optedOutAt) return 'none';
    const conv = await getConversationByContact(contact.id);
    const name = lead.name || contact.displayName || contact.waPhone;

    const inWindow = conv?.lastCustomerMsgAt != null && now.getTime() - conv.lastCustomerMsgAt.getTime() < WINDOW_MS;
    if (conv && inWindow && deps.chakra) {
      const body = `Kak ${name}, nanti Kakak dibantu Kak ${visit.salesName} dari tim sales kami ya 😊`;
      const sent = await sendStaffText(deps.chakra, conv, contact, scope.staffUserId, body);
      if (sent.ok) return 'sent';
      req.log.error({ err: sent.error }, 'reassign notice send failed; queueing the template');
    }
    await enqueue(getDb(), [
      {
        kind: 'reassign_notice',
        dedupeKey: `reassign_notice:${visit.id}:${visit.salesAgentId}`,
        toPhone: contact.waPhone,
        leadId: lead.id,
        visitId: visit.id,
        params: [name, visit.salesName],
        dueAt: now,
      },
    ]);
    return 'queued';
  }

  return async (app: FastifyInstance): Promise<void> => {
    const opts = { preHandler: [requireApiSecret] };

    /** A refused change is 404 or 409 with its code; a successful one is announced to the alerts first. */
    async function finish(result: VisitResult, reply: FastifyReply, build: (ok: Extract<VisitResult, { ok: true }>) => Promise<object>) {
      if (!result.ok) {
        const f = failure(result.error);
        return reply.code(f.status).send(f.body);
      }
      await deps.alerts?.visitChanged(result.change);
      return reply.send({ data: await build(result), error: null });
    }

    app.get('/api/v1/visits', opts, async (req, reply) => {
      const scope = await resolveScope(req);
      if (!scope) return reply.code(401).send(staffRequired);
      const q = ListQuery.safeParse(req.query);
      if (!q.success) return reply.code(400).send(bad);
      const { from, to } = q.data;
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
      if (days < 1 || days > MAX_RANGE_DAYS) return reply.code(400).send(bad);

      const isAdmin = scope.role === 'admin';
      // A sales user sees their own visits whatever they ask for, and nothing without an agent record.
      const salesAgentId = scope.role === 'sales' ? scope.salesAgentId : q.data.salesAgentId;
      if (scope.role === 'sales' && !salesAgentId) return reply.send({ data: [], error: null });

      const views = await listVisitViews({ from: atWib(from, '00:00'), to: atWib(addDays(to, 1), '00:00'), projectId: q.data.projectId, salesAgentId: salesAgentId ?? undefined });
      const leadIds = [...new Set(views.map((v) => v.leadId))];
      const names = new Map(
        leadIds.length
          ? (
              await getDb()
                .select({ id: leads.id, name: leads.name, displayName: contacts.displayName, phone: contacts.waPhone })
                .from(leads)
                .innerJoin(contacts, eq(contacts.id, leads.contactId))
                .where(inArray(leads.id, leadIds))
            ).map((r) => [r.id, r.name || r.displayName || r.phone] as const)
          : []
      );
      const data = views.map((v) => ({ ...v, customerName: names.get(v.leadId) ?? null }));
      return reply.send(isAdmin ? { data, error: null, meta: { outbound: await outboundSummary(clock()) } } : { data, error: null });
    });

    app.get('/api/v1/visits/:id', opts, async (req, reply) => {
      const scope = await resolveScope(req);
      if (!scope) return reply.code(401).send(staffRequired);
      const p = IdParams.safeParse(req.params);
      if (!p.success) return reply.code(404).send(notFound);
      const visit = await getVisitView(p.data.id);
      if (!visit || !visitVisible(scope, visit)) return reply.code(404).send(notFound);
      const lead = await getLead(visit.leadId);
      const contact = lead ? await getContact(lead.contactId) : null;
      if (!lead || !contact) return reply.code(404).send(notFound);
      return reply.send({
        data: {
          visit,
          lead: { id: lead.id, name: lead.name || contact.displayName || contact.waPhone, phone: contact.waPhone },
          summary: await loadHandoverSummary(lead.id, getDb(), visit),
        },
        error: null,
      });
    });

    // Every free slot of one day for the move dialog; the visit's own slot counts as free.
    app.get('/api/v1/visits/:id/slots', opts, async (req, reply) => {
      const scope = await resolveScope(req);
      if (!scope) return reply.code(401).send(staffRequired);
      if (scope.role !== 'admin') return reply.code(403).send(forbidden);
      const p = IdParams.safeParse(req.params);
      const q = z.object({ date: IsoDate }).safeParse(req.query);
      if (!p.success || !q.success) return reply.code(400).send(bad);
      const visit = await getVisitView(p.data.id);
      if (!visit) return reply.code(404).send(notFound);
      const data = await loadSlotData(visit.projectId, q.data.date, q.data.date, { excludeVisitId: visit.id });
      const slots = data ? freeSlots(data, { from: q.data.date, to: q.data.date }, clock()) : [];
      return reply.send({ data: slots.map((s) => ({ startsAt: s.startsAt, date: s.date, time: s.time, label: s.label })), error: null });
    });

    app.post('/api/v1/visits/:id/move', opts, async (req, reply) => {
      const scope = await resolveScope(req);
      if (!scope) return reply.code(401).send(staffRequired);
      if (scope.role !== 'admin') return reply.code(403).send(forbidden);
      const p = IdParams.safeParse(req.params);
      const body = MoveBody.safeParse(req.body);
      if (!p.success || !body.success) return reply.code(400).send(bad);
      const result = await rescheduleVisit({ visitId: p.data.id, startsAt: atWib(body.data.date, body.data.time), actor: actorOf(scope) }, clock());
      return finish(result, reply, async (ok) => ({ visit: ok.visit }));
    });

    app.post('/api/v1/visits/:id/reassign', opts, async (req, reply) => {
      const scope = await resolveScope(req);
      if (!scope) return reply.code(401).send(staffRequired);
      if (scope.role !== 'admin') return reply.code(403).send(forbidden);
      const p = IdParams.safeParse(req.params);
      const body = ReassignBody.safeParse(req.body);
      if (!p.success || !body.success) return reply.code(400).send(bad);
      const now = clock();
      const result = await reassignVisit({ visitId: p.data.id, salesAgentId: body.data.salesAgentId, actor: actorOf(scope) }, now);
      return finish(result, reply, async (ok) => ({ visit: ok.visit, notice: await noticeReassignment(ok.visit, scope, req, now) }));
    });

    app.post('/api/v1/visits/:id/cancel', opts, async (req, reply) => {
      const scope = await resolveScope(req);
      if (!scope) return reply.code(401).send(staffRequired);
      if (scope.role !== 'admin') return reply.code(403).send(forbidden);
      const p = IdParams.safeParse(req.params);
      const body = CancelBody.safeParse(req.body);
      if (!p.success || !body.success) return reply.code(400).send(bad);
      const result = await cancelVisit({ visitId: p.data.id, reason: body.data.reason, actor: actorOf(scope) }, clock());
      return finish(result, reply, async (ok) => ({ visit: ok.visit }));
    });

    app.post('/api/v1/visits/:id/outcome', opts, async (req, reply) => {
      const scope = await resolveScope(req);
      if (!scope) return reply.code(401).send(staffRequired);
      const p = IdParams.safeParse(req.params);
      const body = OutcomeBody.safeParse(req.body);
      if (!p.success || !body.success) return reply.code(400).send(bad);
      const visit = await getVisitView(p.data.id);
      if (!visit || !visitVisible(scope, visit)) return reply.code(404).send(notFound);
      const result = await markOutcome({ visitId: visit.id, outcome: body.data.outcome, actor: actorOf(scope) }, clock());
      return finish(result, reply, async (ok) => ({ visit: ok.visit }));
    });
  };
}
