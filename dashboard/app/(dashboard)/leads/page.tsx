import Link from "next/link";
import { listLeads, STAGES, STAGE_LABEL, VISIT_STATUS_LABEL, type LeadFilters } from "@/lib/api/leads";
import { listProjects } from "@/lib/api/catalog";
import { listRoster } from "@/lib/api/roster";
import { sessionUser } from "@/lib/session";
import { formatRupiahShort, formatWib } from "@/lib/format";

export const dynamic = "force-dynamic";

const CHANNELS = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", other: "Lainnya" } as const;
const select = "h-9 rounded border border-slate-300 px-2 text-sm";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadFilters> }) {
  const f = await searchParams;
  const user = (await sessionUser())!;
  const isAdmin = user.role === "admin";
  // Only admins get the Sales filter; the API already limits a sales user to their own leads.
  const [res, projects, roster] = await Promise.all([
    listLeads({ ...f, page: f.page ?? "1" }, user.id),
    listProjects(),
    isAdmin ? listRoster() : Promise.resolve([]),
  ]);
  const rows = res.data ?? [];
  const meta = res.meta ?? { page: 1, totalPages: 1, total: rows.length, limit: 25 };
  const pageLink = (page: number) => `/leads?${new URLSearchParams({ ...(f as Record<string, string>), page: String(page) }).toString()}`;

  return (
    <div className="max-w-6xl space-y-4">
      <h1 className="text-2xl font-semibold">Leads</h1>
      <form className="flex flex-wrap items-end gap-2 rounded-lg bg-white p-3 shadow-sm" method="get">
        <label className="text-xs">Tahap
          <select name="stage" defaultValue={f.stage ?? ""} className={`${select} block`}>
            <option value="">Semua</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="text-xs">Proyek
          <select name="projectId" defaultValue={f.projectId ?? ""} className={`${select} block`}>
            <option value="">Semua</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        {isAdmin && (
          <label className="text-xs">Sales
            <select name="salesAgentId" defaultValue={f.salesAgentId ?? ""} className={`${select} block`}>
              <option value="">Semua</option>
              {roster.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs">Kanal
          <select name="channel" defaultValue={f.channel ?? ""} className={`${select} block`}>
            <option value="">Semua</option>
            {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs">Dari<input type="date" name="from" defaultValue={f.from} className={`${select} block`} /></label>
        <label className="text-xs">Sampai<input type="date" name="to" defaultValue={f.to} className={`${select} block`} /></label>
        <label className="text-xs">Cari<input name="q" defaultValue={f.q} placeholder="Nama atau no. WA" className={`${select} block`} /></label>
        <button className="h-9 rounded bg-brand-600 px-4 text-sm font-semibold text-white">Terapkan</button>
      </form>

      <table className="w-full rounded-lg bg-white text-left text-sm shadow-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr><th className="px-3 py-2">Nama</th><th>Proyek</th><th>Kanal</th><th>Budget / cicilan</th><th>Minat</th><th>Tahap</th><th>Sales</th><th>Kunjungan</th><th>Suhu</th><th>Terakhir chat</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2">
                <Link href={`/leads/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.name ?? r.waPhone}</Link>
                <div className="text-xs text-slate-500">{r.waPhone}</div>
                {r.needsAttention && <span className="mt-1 inline-block rounded bg-red-100 px-1.5 text-xs font-semibold text-red-700">Perlu ditangani</span>}
                {!r.needsAttention && r.underTakeover && <span className="mt-1 inline-block rounded bg-slate-200 px-1.5 text-xs">Diambil alih</span>}
              </td>
              <td>{r.project?.displayName ?? "—"}</td>
              <td>{r.sourceChannel ? `${CHANNELS[r.sourceChannel as keyof typeof CHANNELS] ?? r.sourceChannel}${r.sourceContentKind ? ` · ${r.sourceContentKind}` : ""}` : "—"}</td>
              <td>
                {r.budgetPrice ? formatRupiahShort(r.budgetPrice) : "—"}
                {r.budgetMonthly ? ` / ${formatRupiahShort(r.budgetMonthly)} per bulan` : ""}
              </td>
              <td>{[r.bedroomsWanted ? `${r.bedroomsWanted} KT` : null, ...r.typeInterest].filter(Boolean).join(", ") || "—"}</td>
              <td><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{STAGE_LABEL[r.stage]}</span></td>
              <td>{r.assignedSales?.name ?? "—"}</td>
              <td className="text-xs">
                {r.nextVisit ? (
                  <>
                    <Link href={`/visits/${r.nextVisit.id}`} className="text-brand-700 hover:underline">{r.nextVisit.label}</Link>
                    <div><span className="rounded bg-slate-100 px-1.5 py-0.5">{VISIT_STATUS_LABEL[r.nextVisit.status] ?? r.nextVisit.status}</span></div>
                  </>
                ) : "—"}
              </td>
              <td>{r.hotCold ?? "—"}</td>
              <td className="text-xs">{r.lastCustomerMsgAt ? formatWib(r.lastCustomerMsgAt) : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-500">Belum ada lead.</td></tr>}
        </tbody>
      </table>
      <div className="flex items-center gap-3 text-sm">
        <span>{meta.total} lead · halaman {meta.page} dari {meta.totalPages}</span>
        {meta.page > 1 && <Link className="text-brand-700 hover:underline" href={pageLink(meta.page - 1)}>‹ Sebelumnya</Link>}
        {meta.page < meta.totalPages && <Link className="text-brand-700 hover:underline" href={pageLink(meta.page + 1)}>Berikutnya ›</Link>}
      </div>
    </div>
  );
}
