import Link from "next/link";
import { notFound } from "next/navigation";
import { getVisitDetail } from "@/lib/api/visits";
import { VISIT_STATUS_LABEL } from "@/lib/api/leads";
import { listRoster } from "@/lib/api/roster";
import { sessionUser } from "@/lib/session";
import { STATUS_STYLE } from "@/lib/schedule";
import { SummaryCard } from "@/components/SummaryCard";
import { VisitActions } from "./VisitActions";

export const dynamic = "force-dynamic";

const ACTIVE = ["scheduled", "confirmed", "awaiting_confirmation"];

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await sessionUser())!;
  const d = await getVisitDetail(id, user.id);
  if (!d) notFound();
  const { visit } = d;
  const isAdmin = user.role === "admin";
  const active = ACTIVE.includes(visit.status);
  // Only an admin can reassign, and only to another active agent who covers this project.
  const agents = isAdmin && active
    ? (await listRoster()).filter((a) => a.active && a.projectIds.includes(visit.projectId) && a.id !== visit.salesAgentId).map((a) => ({ id: a.id, name: a.name }))
    : [];

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm"><Link href="/schedule" className="text-brand-700 hover:underline">← Jadwal</Link></p>
      <h1 className="text-2xl font-semibold">Kunjungan {d.lead.name}</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <section className="space-y-2 rounded-lg bg-white p-4 text-sm shadow-sm">
            <h2 className="font-semibold">Jadwal</h2>
            <p>{visit.label}</p>
            <p>
              {visit.projectName}
              {visit.mapsUrl && <> · <a href={visit.mapsUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">Buka di Maps</a></>}
            </p>
            <p>Sales: {visit.salesName}</p>
            <p>
              <span className={`rounded border px-1.5 py-0.5 text-xs ${STATUS_STYLE[visit.status]}`}>{VISIT_STATUS_LABEL[visit.status] ?? visit.status}</span>
              {visit.status === "cancelled" && visit.cancelReason && <span className="ml-2 text-xs text-slate-600">Alasan: {visit.cancelReason}</span>}
            </p>
            <p><Link href={`/leads/${d.lead.id}`} className="text-brand-700 hover:underline">Buka lead {d.lead.name} ({d.lead.phone})</Link></p>
          </section>
          <VisitActions visitId={visit.id} active={active} started={Date.now() >= Date.parse(visit.startsAt)} isAdmin={isAdmin} agents={agents} />
        </div>
        {d.summary && <SummaryCard summary={d.summary} />}
      </div>
    </div>
  );
}
