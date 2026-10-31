import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { requireApiSecret } from '../middleware/apiSecret.js';
import { getDb } from '../db/client.js';
import { contacts, conversations, leadEvents, leads, messages, projects, staffUsers, vlesUnits, LEAD_STAGES } from '../db/schema/index.js';
import { getAppSettings } from '../settings/appSettings.js';
import type { ChakraClient } from '../chakra/client.js';
import {
  getContact,
  getConversationByContact,
  getLead,
  insertOutbound,
  isUnderTakeover,
  listEvents,
  setLeadStage,
  setTakeover,
  updateConversation,
  updateLeadFacts,
} from '../leads/repository.js';

const bad = { data: null, error: 'VALIDATION_ERROR' };
const notFound = { data: null, error: 'NOT_FOUND' };

const IsoDate = z.iso.date();
const ListQuery = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  channel: z.string().min(1).optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const IdParams = z.object({ id: z.uuid() });
const FactsPatch = z.object({
  name: z.string().trim().min(1).optional(),
  budgetPrice: z.number().int().positive().optional(),
  budgetMonthly: z.number().int().positive().optional(),
  dpBudget: z.number().int().min(0).optional(),
  bedroomsWanted: z.number().int().min(1).max(10).optional(),
  purpose: z.enum(['own_use', 'investment']).optional(),
  timeline: z.string().trim().min(1).optional(),
  domicileArea: z.string().trim().min(1).optional(),
  addConcerns: z.array(z.string().min(1)).optional(),
  hotCold: z.enum(['hot', 'warm', 'cold']).optional(),
  lostReason: z.string().trim().min(1).optional(),
  stage: z.enum(LEAD_STAGES).optional(),
});

/** The staff member acting, from the dashboard's X-Staff-Id header. */
function staffOf(req: FastifyRequest): { actor: string; staffUserId: string | null } {
  const id = z.uuid().safeParse(req.headers['x-staff-id']);
  return id.success ? { actor: `staff:${id.data}`, staffUserId: id.data } : { actor: 'staff', staffUserId: null };
}

const nextDay = (d: string) => new Date(new Date(`${d}T00:00:00+07:00`).getTime() + 86_400_000);

/**
 * A handoff by Moni or the system that no staff member has answered yet. Takeovers staff start
 * themselves (a reply, the toggle) need no attention.
 */
async function needsAttention(leadId: string, conversationId: string): Promise<boolean> {
  const [handoff] = await getDb()
    .select({ at: leadEvents.createdAt })
    .from(leadEvents)
    .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.kind, 'handoff'), inArray(leadEvents.actor, ['moni', 'system'])))
    .orderBy(desc(leadEvents.createdAt))
    .limit(1);
  if (!handoff) return false;
  const [staff] = await getDb()
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.sender, 'staff'), gte(messages.createdAt, handoff.at)));
  return (staff?.n ?? 0) === 0;
}

export function leadRoutes(deps: { chakra?: ChakraClient }) {
  return async (app: FastifyInstance): Promise<void> => {
    const opts = { preHandler: [requireApiSecret] };

    app.get('/api/v1/leads', opts, async (req, reply) => {
      const q = ListQuery.safeParse(req.query);
      if (!q.success) return reply.code(400).send(bad);
      const f = q.data;
      const where: SQL[] = [eq(contacts.isTest, false)];
      if (f.stage) where.push(eq(leads.stage, f.stage));
      if (f.projectId) where.push(eq(leads.currentProjectId, f.projectId));
      if (f.channel) where.push(eq(leads.sourceChannel, f.channel));
      if (f.from) where.push(gte(leads.createdAt, new Date(`${f.from}T00:00:00+07:00`)));
      if (f.to) where.push(lt(leads.createdAt, nextDay(f.to)));
      if (f.q) where.push(or(ilike(leads.name, `%${f.q}%`), ilike(contacts.waPhone, `%${f.q}%`))!);

      const db = getDb();
      const base = db
        .select({ lead: leads, contact: contacts, conv: conversations, projectName: projects.displayName })
        .from(leads)
        .innerJoin(contacts, eq(contacts.id, leads.contactId))
        .leftJoin(conversations, eq(conversations.contactId, leads.contactId))
        .leftJoin(projects, eq(projects.id, leads.currentProjectId))
        .where(and(...where));
      const [total] = await db
        .select({ n: count() })
        .from(leads)
        .innerJoin(contacts, eq(contacts.id, leads.contactId))
        .where(and(...where));
      const rows = await base
        .orderBy(sql`${conversations.lastCustomerMsgAt} desc nulls last`, desc(leads.createdAt))
        .limit(f.limit)
        .offset((f.page - 1) * f.limit);

      const typeIds = [...new Set(rows.flatMap((r) => r.lead.typeInterest))];
      const typeNames = new Map(
        typeIds.length
          ? (
              await db
                .selectDistinctOn([vlesUnits.houseTypeId], { id: vlesUnits.houseTypeId, name: vlesUnits.houseTypeName })
                .from(vlesUnits)
                .where(inArray(vlesUnits.houseTypeId, typeIds))
            ).map((t) => [t.id, t.name])
          : []
      );
      const now = new Date();
      const data = [];
      for (const r of rows) {
        const under = r.conv ? isUnderTakeover(r.conv, now) : false;
        data.push({
          id: r.lead.id,
          name: r.lead.name ?? r.contact.displayName,
          waPhone: r.contact.waPhone,
          stage: r.lead.stage,
          project: r.lead.currentProjectId ? { id: r.lead.currentProjectId, displayName: r.projectName } : null,
          sourceChannel: r.lead.sourceChannel,
          sourceContentKind: r.lead.sourceContentKind,
          budgetPrice: r.lead.budgetPrice,
          budgetMonthly: r.lead.budgetMonthly,
          bedroomsWanted: r.lead.bedroomsWanted,
          typeInterest: r.lead.typeInterest.map((id) => typeNames.get(id) ?? `tipe ${id}`),
          hotCold: r.lead.hotCold,
          lastCustomerMsgAt: r.conv?.lastCustomerMsgAt ?? null,
          underTakeover: under,
          needsAttention: under && r.conv ? await needsAttention(r.lead.id, r.conv.id) : false,
        });
      }
      const n = total?.n ?? 0;
      return reply.send({ data, error: null, meta: { page: f.page, limit: f.limit, total: n, totalPages: Math.max(1, Math.ceil(n / f.limit)) } });
    });

    app.get('/api/v1/leads/:id', opts, async (req, reply) => {
      const p = IdParams.safeParse(req.params);
      if (!p.success) return reply.code(404).send(notFound);
      const lead = await getLead(p.data.id);
      if (!lead) return reply.code(404).send(notFound);
      const contact = await getContact(lead.contactId);
      const conv = await getConversationByContact(lead.contactId);
      const msgs = conv
        ? (
            await getDb()
              .select({ m: messages, staffName: staffUsers.displayName })
              .from(messages)
              .leftJoin(staffUsers, eq(staffUsers.id, messages.staffUserId))
              .where(eq(messages.conversationId, conv.id))
              .orderBy(desc(messages.createdAt), desc(messages.id))
              .limit(200)
          )
            .reverse()
            .map((r) => ({ ...r.m, staffName: r.staffName }))
        : [];
      return reply.send({
        data: {
          lead,
          contact,
          conversation: conv ? { id: conv.id, aiEnabled: conv.aiEnabled, humanTakeoverUntil: conv.humanTakeoverUntil } : null,
          messages: msgs,
          events: await listEvents(lead.id),
        },
        error: null,
      });
    });

    app.patch('/api/v1/leads/:id', opts, async (req, reply) => {
      const p = IdParams.safeParse(req.params);
      const body = FactsPatch.safeParse(req.body);
      if (!p.success || !body.success) return reply.code(400).send(bad);
      if (!(await getLead(p.data.id))) return reply.code(404).send(notFound);
      const { actor } = staffOf(req);
      const { stage, ...facts } = body.data;
      let lead = await updateLeadFacts(p.data.id, facts, actor);
      if (stage) lead = await setLeadStage(p.data.id, stage, actor, { force: true });
      return reply.send({ data: lead, error: null });
    });

    app.post('/api/v1/leads/:id/takeover', opts, async (req, reply) => {
      const p = IdParams.safeParse(req.params);
      const body = z.object({ on: z.boolean() }).safeParse(req.body);
      if (!p.success || !body.success) return reply.code(400).send(bad);
      const lead = await getLead(p.data.id);
      const conv = lead ? await getConversationByContact(lead.contactId) : null;
      if (!conv) return reply.code(404).send(notFound);
      const until = body.data.on ? new Date(Date.now() + (await getAppSettings()).takeoverHours * 3_600_000) : null;
      await setTakeover(conv.id, until, staffOf(req).actor, body.data.on ? 'diambil alih staf' : undefined);
      return reply.send({ data: { humanTakeoverUntil: until }, error: null });
    });

    app.post('/api/v1/leads/:id/ai', opts, async (req, reply) => {
      const p = IdParams.safeParse(req.params);
      const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
      if (!p.success || !body.success) return reply.code(400).send(bad);
      const lead = await getLead(p.data.id);
      const conv = lead ? await getConversationByContact(lead.contactId) : null;
      if (!conv) return reply.code(404).send(notFound);
      await updateConversation(conv.id, { aiEnabled: body.data.enabled });
      return reply.send({ data: { aiEnabled: body.data.enabled }, error: null });
    });

    // A staff reply from the dashboard: goes out through ChakraHQ and pauses Moni.
    app.post('/api/v1/leads/:id/messages', opts, async (req, reply) => {
      const p = IdParams.safeParse(req.params);
      const body = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body);
      if (!p.success || !body.success) return reply.code(400).send(bad);
      const lead = await getLead(p.data.id);
      const contact = lead ? await getContact(lead.contactId) : null;
      const conv = lead ? await getConversationByContact(lead.contactId) : null;
      if (!lead || !contact || !conv) return reply.code(404).send(notFound);
      if (contact.isTest) return reply.code(409).send({ data: null, error: 'TEST_CONTACT' });
      if (!deps.chakra) return reply.code(503).send({ data: null, error: 'CHAKRA_NOT_CONFIGURED' });
      const { actor, staffUserId } = staffOf(req);
      try {
        const sent = await deps.chakra.sendText(conv.waPhoneNumberId ?? '', contact.waPhone, body.data.body);
        const row = await insertOutbound(conv.id, { sender: 'staff', staffUserId, kind: 'text', body: body.data.body, waMessageId: sent.waMessageId, status: 'sent' });
        const until = new Date(Date.now() + (await getAppSettings()).takeoverHours * 3_600_000);
        await setTakeover(conv.id, until, actor, 'dibalas staf dari dashboard');
        return reply.code(201).send({ data: { id: row.id, humanTakeoverUntil: until }, error: null });
      } catch (err) {
        await insertOutbound(conv.id, { sender: 'staff', staffUserId, kind: 'text', body: body.data.body, waMessageId: null, status: 'failed' });
        req.log.error({ err }, 'staff send failed');
        return reply.code(502).send({ data: null, error: 'SEND_FAILED' });
      }
    });
  };
}

