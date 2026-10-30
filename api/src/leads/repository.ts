import { and, asc, desc, eq, gt, inArray, max } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { contacts, conversations, leadEvents, leads, messages, type LeadEventKind, type LeadStage } from '../db/schema/index.js';
import { canMoniSetStage } from './stages.js';

export type Contact = typeof contacts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type { LeadEventKind, LeadStage };

export type LeadFactsPatch = {
  name?: string;
  budgetPrice?: number;
  budgetMonthly?: number;
  dpBudget?: number;
  bedroomsWanted?: number;
  purpose?: 'own_use' | 'investment';
  timeline?: string;
  domicileArea?: string;
  addConcerns?: string[];
  addTypeInterest?: number[];
  hotCold?: 'hot' | 'warm' | 'cold';
  lostReason?: string;
};

export class StageError extends Error {
  constructor(from: LeadStage, to: LeadStage) {
    super(`Stage change ${from} -> ${to} is not allowed here`);
    this.name = 'StageError';
  }
}

// ─── contacts, conversations, leads ─────────────────────────────────────────

export async function getContact(id: string): Promise<Contact | null> {
  const [row] = await getDb().select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return row ?? null;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const [row] = await getDb().select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return row ?? null;
}

export async function getConversationByContact(contactId: string): Promise<Conversation | null> {
  const [row] = await getDb().select().from(conversations).where(eq(conversations.contactId, contactId)).limit(1);
  return row ?? null;
}

export async function getLead(id: string): Promise<Lead | null> {
  const [row] = await getDb().select().from(leads).where(eq(leads.id, id)).limit(1);
  return row ?? null;
}

export async function getLeadByContact(contactId: string): Promise<Lead | null> {
  const [row] = await getDb().select().from(leads).where(eq(leads.contactId, contactId)).limit(1);
  return row ?? null;
}

export async function upsertContact(waPhone: string, displayName: string | null, isTest = false): Promise<Contact> {
  const [row] = await getDb()
    .insert(contacts)
    .values({ waPhone, displayName, isTest })
    .onConflictDoUpdate({
      target: contacts.waPhone,
      // Keep the name we had when WhatsApp sends none.
      set: displayName ? { displayName } : { waPhone },
    })
    .returning();
  if (!row) throw new Error(`Failed to upsert contact ${waPhone}`);
  return row;
}

export async function ensureConversation(contactId: string, waPhoneNumberId: string | null): Promise<Conversation> {
  const [row] = await getDb()
    .insert(conversations)
    .values({ contactId, waPhoneNumberId })
    .onConflictDoUpdate({
      target: conversations.contactId,
      set: waPhoneNumberId ? { waPhoneNumberId } : { contactId },
    })
    .returning();
  if (!row) throw new Error(`Failed to ensure conversation for ${contactId}`);
  return row;
}

export async function ensureLead(contactId: string): Promise<Lead> {
  await getDb().insert(leads).values({ contactId }).onConflictDoNothing({ target: leads.contactId });
  const lead = await getLeadByContact(contactId);
  if (!lead) throw new Error(`Failed to ensure lead for ${contactId}`);
  return lead;
}

async function leadIdForConversation(conversationId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: leads.id })
    .from(conversations)
    .innerJoin(leads, eq(leads.contactId, conversations.contactId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row?.id ?? null;
}

// ─── messages ───────────────────────────────────────────────────────────────

export async function insertInbound(
  conversationId: string,
  m: { waMessageId: string | null; kind: string; body: string; mediaUrl?: string | null; createdAt: Date }
): Promise<{ id: string } | 'duplicate'> {
  const db = getDb();
  const [row] = await db
    .insert(messages)
    .values({
      conversationId,
      waMessageId: m.waMessageId,
      direction: 'in',
      sender: 'customer',
      kind: m.kind,
      body: m.body,
      mediaUrl: m.mediaUrl ?? null,
      status: 'received',
      createdAt: m.createdAt,
    })
    .onConflictDoNothing({ target: messages.waMessageId })
    .returning({ id: messages.id });
  if (!row) return 'duplicate';
  await db.update(conversations).set({ lastCustomerMsgAt: m.createdAt }).where(eq(conversations.id, conversationId));
  return row;
}

export async function insertOutbound(
  conversationId: string,
  m: {
    sender: 'moni' | 'staff' | 'system';
    staffUserId?: string | null;
    kind: string;
    body: string;
    mediaUrl?: string | null;
    waMessageId: string | null;
    status: 'sent' | 'failed' | 'recorded';
  }
): Promise<{ id: string }> {
  const [row] = await getDb()
    .insert(messages)
    .values({
      conversationId,
      waMessageId: m.waMessageId,
      direction: 'out',
      sender: m.sender,
      staffUserId: m.staffUserId ?? null,
      kind: m.kind,
      body: m.body,
      mediaUrl: m.mediaUrl ?? null,
      status: m.status,
    })
    .returning({ id: messages.id });
  if (!row) throw new Error('Failed to store outbound message');
  return row;
}

/** The last `limit` messages, oldest first. */
export async function recentMessages(conversationId: string, limit: number): Promise<Message[]> {
  const rows = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
  return rows.reverse();
}

export async function customerMessagesSince(conversationId: string, since: Date): Promise<Message[]> {
  return getDb()
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.sender, 'customer'), gt(messages.createdAt, since)))
    .orderBy(asc(messages.createdAt), asc(messages.id));
}

export async function lastOutboundAt(conversationId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ at: max(messages.createdAt) })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'out')));
  return row?.at ?? null;
}

// ─── lead facts, stage, project ─────────────────────────────────────────────

export async function recordEvent(leadId: string, kind: LeadEventKind, payload: object, actor: string): Promise<void> {
  await getDb().insert(leadEvents).values({ leadId, kind, payload, actor });
}

/** Newest first, optionally only some kinds. */
export async function listEvents(leadId: string, kinds?: LeadEventKind[]): Promise<LeadEvent[]> {
  const where = kinds?.length
    ? and(eq(leadEvents.leadId, leadId), inArray(leadEvents.kind, kinds))
    : eq(leadEvents.leadId, leadId);
  return getDb().select().from(leadEvents).where(where).orderBy(desc(leadEvents.createdAt), desc(leadEvents.id));
}

const appendUnique = <T>(list: T[], add: T[] | undefined): T[] => [...list, ...(add ?? []).filter((x, i, a) => !list.includes(x) && a.indexOf(x) === i)];

const SCALAR_FIELDS = ['name', 'budgetPrice', 'budgetMonthly', 'dpBudget', 'bedroomsWanted', 'purpose', 'timeline', 'domicileArea', 'hotCold', 'lostReason'] as const;

export async function updateLeadFacts(leadId: string, patch: LeadFactsPatch, actor: string): Promise<Lead> {
  const lead = await getLead(leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  const set: Partial<typeof leads.$inferInsert> = {};
  const keys: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === 'addConcerns') {
      const next = appendUnique(lead.concerns, v as string[]);
      if (next.length !== lead.concerns.length) (set.concerns = next), keys.push('concerns');
    } else if (k === 'addTypeInterest') {
      const next = appendUnique(lead.typeInterest, v as number[]);
      if (next.length !== lead.typeInterest.length) (set.typeInterest = next), keys.push('typeInterest');
    } else if ((SCALAR_FIELDS as readonly string[]).includes(k) && lead[k as keyof Lead] !== v) {
      (set as Record<string, unknown>)[k] = v;
      keys.push(k);
    }
  }
  if (keys.length === 0) return lead;
  const [row] = await getDb()
    .update(leads)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
    .returning();
  await recordEvent(leadId, 'fact_updated', { keys }, actor);
  return row!;
}

export async function setLeadStage(leadId: string, to: LeadStage, actor: string, opts: { force?: boolean } = {}): Promise<Lead> {
  const lead = await getLead(leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  if (lead.stage === to) return lead;
  if (!opts.force && !canMoniSetStage(lead.stage, to)) throw new StageError(lead.stage, to);
  const [row] = await getDb()
    .update(leads)
    .set({ stage: to, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
    .returning();
  await recordEvent(leadId, 'stage_changed', { from: lead.stage, to }, actor);
  return row!;
}

export async function setLeadProject(
  leadId: string,
  projectId: number,
  actor: string,
  source?: { channel: string | null; contentKind: string | null; ref: string | null }
): Promise<Lead> {
  const lead = await getLead(leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  const set: Partial<typeof leads.$inferInsert> = {
    currentProjectId: projectId,
    projectsOfInterest: appendUnique(lead.projectsOfInterest, [projectId]),
    updatedAt: new Date(),
  };
  // The first source sticks: it is what brought the lead in.
  if (source && !lead.sourceChannel && !lead.sourceRef) {
    set.sourceChannel = source.channel;
    set.sourceContentKind = source.contentKind;
    set.sourceRef = source.ref;
  }
  const [row] = await getDb().update(leads).set(set).where(eq(leads.id, leadId)).returning();
  await recordEvent(leadId, 'project_set', { projectId, ...(source ? { source } : {}) }, actor);
  return row!;
}

export async function optOut(contactId: string, leadId: string, actor: string): Promise<void> {
  await getDb().update(contacts).set({ optedOutAt: new Date() }).where(eq(contacts.id, contactId));
  await setLeadStage(leadId, 'opted_out', actor, { force: true });
  await recordEvent(leadId, 'opt_out', {}, actor);
}

// ─── takeover ───────────────────────────────────────────────────────────────

export async function setTakeover(conversationId: string, until: Date | null, actor: string, reason?: string): Promise<void> {
  await getDb().update(conversations).set({ humanTakeoverUntil: until }).where(eq(conversations.id, conversationId));
  if (until) {
    const leadId = await leadIdForConversation(conversationId);
    if (leadId) await recordEvent(leadId, 'handoff', { until: until.toISOString(), ...(reason ? { reason } : {}) }, actor);
  }
}

export function isUnderTakeover(c: Conversation, now: Date): boolean {
  return c.humanTakeoverUntil !== null && c.humanTakeoverUntil.getTime() > now.getTime();
}

export async function updateConversation(id: string, patch: Partial<Pick<Conversation, 'aiEnabled' | 'lastMoniMsgAt' | 'lastCannedReplyAt'>>): Promise<void> {
  await getDb().update(conversations).set(patch).where(eq(conversations.id, id));
}
