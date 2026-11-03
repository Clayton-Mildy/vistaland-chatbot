import Link from "next/link";
import { listVisits, type VisitRow } from "@/lib/api/visits";
import { listProjects } from "@/lib/api/catalog";
import { listRoster } from "@/lib/api/roster";
import { sessionUser } from "@/lib/session";
import { dayLabel, groupVisits, shiftDate, STATUS_STYLE, weekDates, wibClock, wibDay } from "@/lib/schedule";

export const dynamic = "force-dynamic";

type Params = { view?: string; date?: string; projectId?: string; salesAgentId?: string };
const select = "h-9 rounded border border-slate-300 px-2 text-sm";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function Chip({ v }: { v: VisitRow }) {
  return (
    <Link href={`/visits/${v.id}`} className={`block rounded border px-2 py-1 text-xs hover:brightness-95 ${STATUS_STYLE[v.status]}`}>
      <span className="font-semibold">{wibClock(v.startsAt)}</span> {v.customerName ?? "—"}
      <span className="block">{v.projectName}</span>
    </Link>
  );
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Params> }) {
  const f = await searchParams;
  const user = (await sessionUser())!;
  const isAdmin = user.role === "admin";
  const view = f.view === "day" ? "day" : "week";
  const today = wibDay(new Date().toISOString());
  const date = f.date && DATE.test(f.date) ? f.date : today;
  const dates = view === "week" ? weekDates(date) : [date];

  const [{ visits, outbound }, projects, roster] = await Promise.all([
    listVisits({ from: dates[0]!, to: dates[dates.length - 1]!, projectId: f.projectId, salesAgentId: isAdmin ? f.salesAgentId : undefined }, user.id),
    isAdmin ? listProjects() : Promise.resolve([]),
    isAdmin ? listRoster() : Promise.resolve([]),
  ]);

  // Rows are the active agents (for an admin, narrowed by the filters), plus anyone with a visit in view.
  const covers = (projectIds: number[]) => !f.projectId || projectIds.includes(Number(f.projectId));
  const agents = new Map<string, string>();
  for (const a of roster) if (a.active && covers(a.projectIds) && (!f.salesAgentId || a.id === f.salesAgentId)) agents.set(a.id, a.name);
  for (const v of visits) agents.set(v.salesAgentId, v.salesName);
  const agentList = [...agents].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name));
  const grouped = groupVisits(visits, agentList.map((a) => a.id), dates);

  const step = view === "week" ? 7 : 1;
  const link = (over: Partial<Params>) => {
    const qs = new URLSearchParams(Object.entries({ view, date, projectId: f.projectId, salesAgentId: f.salesAgentId, ...over }).filter(([, v]) => v) as [string, string][]);
    return `/schedule?${qs.toString()}`;
  };
  const title = view === "week" ? `${dayLabel(dates[0]!)} – ${dayLabel(dates[6]!)}` : dayLabel(date);

  return (
    <div className="max-w-7xl space-y-4">
      <h1 className="text-2xl font-semibold">Jadwal</h1>

      {outbound && outbound.held > 0 && (
        <p className="rounded bg-amber-100 px-3 py-2 text-sm text-amber-900">
          {outbound.held} pesan WhatsApp untuk sales tertahan: <Link href="/settings" className="underline">atur template di Pengaturan</Link>
        </p>
      )}
      {outbound && outbound.failed > 0 && (
        <p className="rounded bg-red-100 px-3 py-2 text-sm text-red-900">{outbound.failed} pesan WhatsApp gagal terkirim dalam 7 hari terakhir.</p>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-3 shadow-sm">
        <div className="flex items-center gap-1 text-sm">
          <Link href={link({ date: shiftDate(date, -step) })} className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100">← Sebelumnya</Link>
          <Link href={link({ date: today })} className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100">Hari ini</Link>
          <Link href={link({ date: shiftDate(date, step) })} className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100">Berikutnya →</Link>
        </div>
        <div className="flex gap-1 text-sm">
          <Link href={link({ view: "week" })} className={`rounded px-3 py-1.5 ${view === "week" ? "bg-brand-600 text-white" : "border border-slate-300 hover:bg-slate-100"}`}>Minggu</Link>
          <Link href={link({ view: "day" })} className={`rounded px-3 py-1.5 ${view === "day" ? "bg-brand-600 text-white" : "border border-slate-300 hover:bg-slate-100"}`}>Hari</Link>
        </div>
        <span className="text-sm font-medium">{title}</span>
        {isAdmin && (
          <form method="get" className="ml-auto flex flex-wrap items-end gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="date" value={date} />
            <label className="text-xs">Proyek
              <select name="projectId" defaultValue={f.projectId ?? ""} className={`${select} block`}>
                <option value="">Semua</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
              </select>
            </label>
            <label className="text-xs">Sales
              <select name="salesAgentId" defaultValue={f.salesAgentId ?? ""} className={`${select} block`}>
                <option value="">Semua</option>
                {roster.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <button className="h-9 rounded bg-brand-600 px-4 text-sm font-semibold text-white">Terapkan</button>
          </form>
        )}
      </div>

      {agentList.length === 0 ? (
        <p className="rounded-lg bg-white p-4 text-sm text-slate-500 shadow-sm">Belum ada jadwal kunjungan.</p>
      ) : view === "week" ? (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full min-w-[900px] table-fixed text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="w-32 px-3 py-2">Sales</th>
                {dates.map((d) => <th key={d} className={`px-2 py-2 ${d === today ? "text-brand-700" : ""}`}>{dayLabel(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {agentList.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  {dates.map((d) => (
                    <td key={d} className="space-y-1 px-2 py-2">
                      {grouped.get(a.id)!.get(d)!.map((v) => <Chip key={v.id} v={v} />)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${agentList.length}, minmax(180px, 1fr))` }}>
          {agentList.map((a) => {
            const list = grouped.get(a.id)!.get(date)!;
            return (
              <section key={a.id} className="space-y-1 rounded-lg bg-white p-3 shadow-sm">
                <h2 className="text-sm font-semibold">{a.name}</h2>
                {list.map((v) => <Chip key={v.id} v={v} />)}
                {list.length === 0 && <p className="text-xs text-slate-500">Tidak ada kunjungan.</p>}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
