import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeadDetail, type LeadEvent } from "@/lib/api/leads";
import { formatRupiah, formatWib } from "@/lib/format";
import { LeadControls } from "./LeadControls";

export const dynamic = "force-dynamic";

function eventText(e: LeadEvent): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.kind) {
    case "stage_changed":
      return `Tahap: ${p.from} → ${p.to}`;
    case "fact_updated":
      return `Data diperbarui: ${(p.keys as string[] | undefined)?.join(", ") ?? ""}`;
    case "material_sent":
      return `Materi terkirim: ${p.filename ?? p.kind}`;
    case "material_failed":
      return `Materi gagal terkirim: ${p.error ?? ""}`;
    case "simulation_sent":
      return `Simulasi: ${p.typeName ?? ""}, ${p.tenorYears} th, ${typeof p.monthlyFixed === "number" ? formatRupiah(p.monthlyFixed) : "—"}/bulan`;
    case "handoff":
      return `Diserahkan ke tim: ${p.reason ?? "—"}${typeof p.until === "string" ? ` (sampai ${formatWib(p.until)})` : ""}`;
    case "opt_out":
      return "Konsumen minta tidak dihubungi lagi";
    case "project_set":
      return `Proyek ditetapkan (id ${p.projectId})`;
    default:
      return e.kind;
  }
}

const actorText = (a: string) => (a === "moni" ? "Moni" : a === "system" ? "Sistem" : a.startsWith("staff") ? "Staf" : a);

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getLeadDetail(id);
  if (!d) notFound();
  const name = d.lead.name ?? d.contact.displayName ?? d.contact.waPhone;

  return (
    <div className="max-w-6xl space-y-4">
      <p className="text-sm"><Link href="/leads" className="text-brand-700 hover:underline">← Leads</Link></p>
      <h1 className="text-2xl font-semibold">{name} <span className="text-base font-normal text-slate-500">{d.contact.waPhone}</span></h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section className="space-y-2 rounded-lg bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Percakapan WhatsApp</h2>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto">
            {d.messages.map((m) => {
              const mine = m.direction === "out";
              const who = m.sender === "moni" ? "Moni" : m.sender === "staff" ? `Staf${m.staffName ? `: ${m.staffName}` : ""}` : m.sender === "system" ? "Sistem" : name;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${mine ? (m.sender === "staff" ? "bg-amber-50" : "bg-brand-50") : "bg-slate-100"}`}>
                    <div className="text-xs font-semibold text-slate-500">{who}</div>
                    {m.mediaUrl ? (
                      <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">[{m.kind}] {m.body}</a>
                    ) : m.kind !== "text" && m.direction === "in" ? (
                      <span className="italic">[{m.kind}] {m.body}</span>
                    ) : (
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    )}
                    <div className="mt-1 text-right text-[10px] text-slate-500">
                      {formatWib(m.createdAt)}{m.status === "failed" && <span className="ml-1 font-semibold text-red-700">gagal terkirim</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            {d.messages.length === 0 && <p className="text-sm text-slate-500">Belum ada pesan.</p>}
          </div>
        </section>
        <aside className="space-y-4">
          <LeadControls detail={d} />
          <section className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-semibold">Riwayat</h2>
            <ul className="space-y-1.5 text-sm">
              {d.events.map((e) => (
                <li key={e.id}>
                  <span className="text-xs text-slate-500">{formatWib(e.createdAt)} · {actorText(e.actor)}</span>
                  <div>{eventText(e)}</div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
