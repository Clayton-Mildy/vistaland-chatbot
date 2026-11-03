import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { contacts, leadEvents, leads, vlesUnits } from '../db/schema/index.js';
import { formatRupiahShort } from '../knowledge/format.js';
import type { DbOrTx } from '../outbound/repository.js';
import { activeVisitForLead, type VisitView } from '../scheduling/visits.js';
import type { Contact, Lead, LeadEvent } from './repository.js';
import { simulationLine, type MaterialPayload, type SimulationPayload } from './state.js';

// The step-9 handover: what a sales person should know about a customer before the visit.

export type HandoverSummary = {
  name: string;
  phone: string;
  // Channel · content kind, e.g. "instagram · reels".
  source: string | null;
  location: string | null;
  purpose: string | null;
  need: string | null;
  budget: string | null;
  concerns: string[];
  materials: string[];
  simulations: string[];
  visit: { label: string; salesName: string; status: string } | null;
  notes: string | null;
};

const PURPOSE = { own_use: 'ditempati', investment: 'investasi' } as const;

const joined = (parts: (string | null)[], sep: string): string | null => {
  const present = parts.filter((p): p is string => !!p);
  return present.length > 0 ? present.join(sep) : null;
};

/** leads.summary is a JSON object whose `notes` the summary job writes. */
function notesOf(summary: unknown): string | null {
  const notes = (summary as { notes?: unknown } | null)?.notes;
  return typeof notes === 'string' && notes.trim() !== '' ? notes : null;
}

export function buildHandoverSummary(input: {
  lead: Lead;
  contact: Contact;
  events: LeadEvent[];
  typeNames: Map<number, string>;
  visit: VisitView | null;
}): HandoverSummary {
  const { lead, contact, events, typeNames, visit } = input;
  // Events arrive newest first; the customer was sent things oldest first.
  const oldestFirst = [...events].reverse();
  const payloads = <T>(kind: LeadEvent['kind']) => oldestFirst.filter((e) => e.kind === kind).map((e) => e.payload as T);

  const types = lead.typeInterest.map((id) => typeNames.get(id) ?? `tipe ${id}`);
  return {
    name: lead.name || contact.displayName || contact.waPhone,
    phone: contact.waPhone,
    source: joined([lead.sourceChannel, lead.sourceContentKind], ' · '),
    location: lead.domicileArea || null,
    purpose: lead.purpose ? PURPOSE[lead.purpose] : null,
    need: joined([lead.bedroomsWanted ? `${lead.bedroomsWanted} kamar` : null, ...types], ', '),
    budget: joined(
      [
        lead.budgetPrice === null ? null : formatRupiahShort(lead.budgetPrice),
        lead.dpBudget === null ? null : `DP ${formatRupiahShort(lead.dpBudget)}`,
        lead.budgetMonthly === null ? null : `cicilan ${formatRupiahShort(lead.budgetMonthly)}/bulan`,
      ],
      ', '
    ),
    concerns: lead.concerns,
    materials: payloads<MaterialPayload>('material_sent').map((p) => p.filename ?? p.kind ?? 'materi'),
    simulations: payloads<SimulationPayload>('simulation_sent').map(simulationLine),
    visit: visit ? { label: visit.label, salesName: visit.salesName, status: visit.status } : null,
    notes: notesOf(lead.summary),
  };
}

export function summaryLine(s: HandoverSummary): string {
  return (
    joined(
      [
        s.source,
        s.location,
        s.purpose,
        s.need,
        s.budget,
        s.concerns.length > 0 ? `Keraguan: ${s.concerns.join('; ')}` : null,
        s.materials.length > 0 ? `Materi: ${s.materials.join(', ')}` : null,
        s.simulations.length > 0 ? `Simulasi: ${s.simulations.join('; ')}` : null,
        s.notes,
      ],
      ' · '
    ) ?? ''
  );
}

/**
 * Reads what the summary needs. `visit` is the visit to show; left out, it is the lead's active
 * one. Pass a transaction as `db` to see rows it has not committed yet.
 */
export async function loadHandoverSummary(leadId: string, db: DbOrTx = getDb(), visit?: VisitView | null): Promise<HandoverSummary | null> {
  const [row] = await db.select({ lead: leads, contact: contacts }).from(leads).innerJoin(contacts, eq(contacts.id, leads.contactId)).where(eq(leads.id, leadId)).limit(1);
  if (!row) return null;
  const events = await db
    .select()
    .from(leadEvents)
    .where(and(eq(leadEvents.leadId, leadId), inArray(leadEvents.kind, ['material_sent', 'simulation_sent'])))
    .orderBy(desc(leadEvents.createdAt), desc(leadEvents.id));
  const typeIds = row.lead.typeInterest;
  const names = typeIds.length
    ? await db.selectDistinctOn([vlesUnits.houseTypeId], { id: vlesUnits.houseTypeId, name: vlesUnits.houseTypeName }).from(vlesUnits).where(inArray(vlesUnits.houseTypeId, typeIds))
    : [];
  return buildHandoverSummary({
    lead: row.lead,
    contact: row.contact,
    events,
    typeNames: new Map(names.map((t) => [t.id, t.name])),
    visit: visit === undefined ? await activeVisitForLead(leadId, db) : visit,
  });
}
