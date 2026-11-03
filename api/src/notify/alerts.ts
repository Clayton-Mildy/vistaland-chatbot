import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { contacts, leads, projects, salesAgentProjects, salesAgents, staffUsers } from '../db/schema/index.js';
import type { OutboundRow } from '../outbound/repository.js';
import { SALES_ALERT_LABEL } from '../outbound/salesAlert.js';
import { wibLabel } from '../scheduling/time.js';
import type { Visit, VisitChange } from '../scheduling/visits.js';
import type { Notifier, PushNote } from './push.js';

export type Alerts = {
  leadNeedsStaff(leadId: string, reason: string, kind: 'handoff' | 'failure'): Promise<void>;
  availabilityUnverified(leadId: string, projectId: number, typeName: string): Promise<void>;
  // A customer asked for a visit at a project whose gallery hours or sales roster are not set.
  visitNeedsScheduling(leadId: string, projectId: number, requested: string): Promise<void>;
  visitChanged(change: VisitChange): Promise<void>;
  outboundFailed(row: OutboundRow): Promise<void>;
};

const uniq = (ids: string[]) => [...new Set(ids)];

/** Active accounts linked to these sales agents; an agent without an account has none. */
async function accountsOfAgents(agentIds: string[]): Promise<string[]> {
  if (agentIds.length === 0) return [];
  const rows = await getDb()
    .select({ id: staffUsers.id })
    .from(salesAgents)
    .innerJoin(staffUsers, eq(staffUsers.id, salesAgents.staffUserId))
    .where(and(inArray(salesAgents.id, agentIds), eq(staffUsers.isActive, true)));
  return rows.map((r) => r.id);
}

async function activeAdmins(): Promise<string[]> {
  const rows = await getDb()
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(and(eq(staffUsers.role, 'admin'), eq(staffUsers.isActive, true)));
  return rows.map((r) => r.id);
}

/** Active agents covering a project, with an account. */
async function accountsCovering(projectId: number): Promise<string[]> {
  const rows = await getDb()
    .select({ id: staffUsers.id })
    .from(salesAgentProjects)
    .innerJoin(salesAgents, eq(salesAgents.id, salesAgentProjects.salesAgentId))
    .innerJoin(staffUsers, eq(staffUsers.id, salesAgents.staffUserId))
    .where(and(eq(salesAgentProjects.projectId, projectId), eq(salesAgents.active, true), eq(staffUsers.isActive, true)));
  return rows.map((r) => r.id);
}

async function leadInfo(leadId: string): Promise<{ who: string; assignedSalesId: string | null } | null> {
  const [r] = await getDb()
    .select({ name: leads.name, displayName: contacts.displayName, phone: contacts.waPhone, assignedSalesId: leads.assignedSalesId })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .where(eq(leads.id, leadId));
  return r ? { who: r.name ?? r.displayName ?? r.phone, assignedSalesId: r.assignedSalesId } : null;
}

/** Push alerts for staff; each method is best effort and logs instead of throwing. */
export function createAlerts(deps: { notifier: Notifier | null; dashboardUrl: string }): Alerts {
  const { notifier, dashboardUrl } = deps;
  const leadUrl = (id: string) => `${dashboardUrl}/leads/${id}`;
  const visitUrl = (id: string) => `${dashboardUrl}/visits/${id}`;
  const scheduleUrl = `${dashboardUrl}/schedule`;

  async function guarded(what: string, fn: (n: Notifier) => Promise<void>): Promise<void> {
    if (!notifier) return;
    try {
      await fn(notifier);
    } catch (err) {
      console.error(`[alerts] ${what} failed:`, err instanceof Error ? err.message : err);
    }
  }
  const push = async (n: Notifier, to: string[], note: PushNote) => {
    const ids = uniq(to);
    if (ids.length > 0) await n.send(ids, note);
  };

  return {
    leadNeedsStaff: (leadId, reason, kind) =>
      guarded('leadNeedsStaff', async (n) => {
        const lead = await leadInfo(leadId);
        if (!lead) return;
        const to = [...(await activeAdmins()), ...(await accountsOfAgents(lead.assignedSalesId ? [lead.assignedSalesId] : []))];
        await push(n, to, {
          title: kind === 'handoff' ? 'Perlu ditangani' : 'Moni gagal menjawab',
          body: `${lead.who}: ${reason}`,
          url: leadUrl(leadId),
        });
      }),

    visitNeedsScheduling: (leadId, projectId, requested) =>
      guarded('visitNeedsScheduling', async (n) => {
        const lead = await leadInfo(leadId);
        if (!lead) return;
        let to = await accountsCovering(projectId);
        if (to.length === 0) to = await activeAdmins();
        await push(n, to, {
          title: 'Atur jadwal kunjungan',
          body: `${lead.who} minta kunjungan ${requested}. Jadwal proyek belum diatur, mohon hubungi konsumen.`,
          url: leadUrl(leadId),
        });
      }),

    availabilityUnverified: (leadId, projectId, typeName) =>
      guarded('availabilityUnverified', async (n) => {
        const lead = await leadInfo(leadId);
        if (!lead) return;
        let to = await accountsOfAgents(lead.assignedSalesId ? [lead.assignedSalesId] : []);
        if (to.length === 0) to = await accountsCovering(projectId);
        if (to.length === 0) to = await activeAdmins();
        await push(n, to, {
          title: 'Cek ketersediaan unit',
          body: `${lead.who}: stok ${typeName} belum bisa dipastikan, mohon dicek manual.`,
          url: leadUrl(leadId),
        });
      }),

    visitChanged: (change) =>
      guarded('visitChanged', async (n) => {
        const { kind, visit, previous } = change;
        if (visit.isTest || kind === 'outcome') return;
        const events: { agentId: string; label: string; visit: Visit; url: string }[] = [];
        const movedAway = previous && previous.salesAgentId !== visit.salesAgentId && (kind === 'rescheduled' || kind === 'reassigned');
        if (movedAway) {
          // The visit is no longer theirs, so its page would be a 404: point them at their schedule.
          events.push({ agentId: previous.salesAgentId, label: SALES_ALERT_LABEL.movedAway, visit: previous, url: scheduleUrl });
          events.push({ agentId: visit.salesAgentId, label: SALES_ALERT_LABEL.booked, visit, url: visitUrl(visit.id) });
        } else if (kind === 'booked') events.push({ agentId: visit.salesAgentId, label: SALES_ALERT_LABEL.booked, visit, url: visitUrl(visit.id) });
        else if (kind === 'rescheduled') events.push({ agentId: visit.salesAgentId, label: SALES_ALERT_LABEL.rescheduled, visit, url: visitUrl(visit.id) });
        else if (kind === 'cancelled') events.push({ agentId: visit.salesAgentId, label: SALES_ALERT_LABEL.cancelled, visit, url: visitUrl(visit.id) });
        if (events.length === 0) return;

        const lead = await leadInfo(visit.leadId);
        const [project] = await getDb().select({ name: projects.displayName }).from(projects).where(eq(projects.id, visit.projectId));
        for (const e of events) {
          const to = await accountsOfAgents([e.agentId]);
          await push(n, to, {
            title: e.label,
            body: `${lead?.who ?? 'Calon pembeli'} · ${project?.name ?? 'Proyek'} · ${wibLabel(e.visit.startsAt)}`,
            url: e.url,
          });
        }
      }),

    outboundFailed: (row) =>
      guarded('outboundFailed', async (n) => {
        const url = row.visitId ? visitUrl(row.visitId) : row.leadId ? leadUrl(row.leadId) : dashboardUrl;
        await push(n, await activeAdmins(), {
          title: 'Pesan WhatsApp gagal terkirim',
          body: `${row.kind} ke ${row.toPhone}: ${row.lastError ?? 'alasan tidak diketahui'}`,
          url,
        });
      }),
  };
}
