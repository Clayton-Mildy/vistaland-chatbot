import { inArray } from 'drizzle-orm';
import { getConfig } from '../config.js';
import { salesAgents } from '../db/schema/index.js';
import { loadHandoverSummary, summaryLine, type HandoverSummary } from '../leads/summary.js';
import { getVisitView, type VisitChange } from '../scheduling/visits.js';
import { wibLabel } from '../scheduling/time.js';
import { enqueue, type DbOrTx, type NewOutbound } from './repository.js';
import { templateParam } from './templateParams.js';

// What a visit event is called to the sales agent it concerns. Web push and the WhatsApp alert
// to the agent use the same wording.
export const SALES_ALERT_LABEL = {
  booked: 'Kunjungan baru',
  rescheduled: 'Jadwal kunjungan berubah',
  cancelled: 'Kunjungan dibatalkan',
  movedAway: 'Kunjungan dialihkan ke sales lain',
} as const;

// The sales_alert template (category UTILITY, language id), as approved in WhatsApp Manager:
//
//   Halo Kak {{1}}, ada update kunjungan: *{{2}}*.
//   Konsumen: {{3}}
//   Waktu: {{4}}
//   Proyek: {{5}}
//   Ringkasan: {{6}}
//   Detail: {{7}}
//
// {{1}} agent name, {{2}} event label, {{3}} "<customer name> (<phone>)", {{4}} visit time,
// {{5}} project, {{6}} summaryLine, {{7}} <dashboard>/visits/<id>.

export type SalesAlertContext = {
  summary: HandoverSummary;
  agents: Map<string, { name: string; waPhone: string }>;
  projectName: string;
  dashboardUrl: string;
  now: Date;
};

type Alert = { agentId: string; label: keyof typeof SALES_ALERT_LABEL };

/** Which agent hears what: the one who gains the visit hears "booked", the one who loses it "movedAway". */
function recipients(change: VisitChange): Alert[] {
  const agentId = change.visit.salesAgentId;
  const oldAgentId = change.previous?.salesAgentId;
  switch (change.kind) {
    case 'booked':
      return [{ agentId, label: 'booked' }];
    case 'cancelled':
      return [{ agentId, label: 'cancelled' }];
    case 'rescheduled':
      return oldAgentId && oldAgentId !== agentId
        ? [{ agentId: oldAgentId, label: 'movedAway' }, { agentId, label: 'booked' }]
        : [{ agentId, label: 'rescheduled' }];
    case 'reassigned':
      return oldAgentId
        ? [{ agentId: oldAgentId, label: 'movedAway' }, { agentId, label: 'booked' }]
        : [{ agentId, label: 'booked' }];
    case 'outcome':
      return [];
  }
}

export function salesAlertRows(change: VisitChange, ctx: SalesAlertContext): NewOutbound[] {
  if (change.visit.isTest) return [];
  const { visit } = change;
  const rows: NewOutbound[] = [];
  for (const { agentId, label } of recipients(change)) {
    const agent = ctx.agents.get(agentId);
    if (!agent) continue;
    rows.push({
      kind: 'sales_alert',
      dedupeKey: `sales_alert:${visit.id}:${label}:${agentId}`,
      toPhone: agent.waPhone,
      leadId: visit.leadId,
      visitId: visit.id,
      params: [
        agent.name,
        SALES_ALERT_LABEL[label],
        `${ctx.summary.name} (${ctx.summary.phone})`,
        wibLabel(visit.startsAt),
        ctx.projectName,
        summaryLine(ctx.summary),
        `${ctx.dashboardUrl}/visits/${visit.id}`,
      ].map((p) => templateParam(p)),
      dueAt: ctx.now,
    });
  }
  return rows;
}

/** Queues the alerts for a visit change. Call it with the transaction that made the change. */
export async function queueSalesAlerts(db: DbOrTx, change: VisitChange, now: Date): Promise<void> {
  if (change.visit.isTest || change.kind === 'outcome') return;
  const view = await getVisitView(change.visit.id, db);
  if (!view) return;
  const summary = await loadHandoverSummary(view.leadId, db, view);
  if (!summary) return;
  const agentIds = [...new Set([change.visit.salesAgentId, change.previous?.salesAgentId].filter((id): id is string => !!id))];
  const agentRows = await db.select({ id: salesAgents.id, name: salesAgents.name, waPhone: salesAgents.waPhone }).from(salesAgents).where(inArray(salesAgents.id, agentIds));
  const rows = salesAlertRows(change, {
    summary,
    agents: new Map(agentRows.map((a) => [a.id, { name: a.name, waPhone: a.waPhone }])),
    projectName: view.projectName,
    dashboardUrl: getConfig().DASHBOARD_PUBLIC_URL.replace(/\/+$/, ''),
    now,
  });
  await enqueue(db, rows);
}
