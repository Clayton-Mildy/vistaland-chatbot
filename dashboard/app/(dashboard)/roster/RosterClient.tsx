"use client";

import { useState, useTransition } from "react";
import {
  addTimeOffAction,
  createAgentAction,
  deleteTimeOffAction,
  saveAvailabilityAction,
  updateAgentAction,
} from "@/actions/rosterActions";
import type { AvailabilityRow, RosterAgent } from "@/lib/api/roster";

type ProjectOption = { id: number; name: string };
type Account = { id: string; label: string; linked: boolean };

const input = "h-9 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-600 focus:outline-none";
const button = "h-9 rounded bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60";
const link = "text-sm text-brand-700 hover:underline disabled:opacity-60";
const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

/** Runs a server action and keeps its pending state and outcome message. */
function useAction() {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ error?: string; note?: string }>({});
  const run = (fn: () => Promise<{ error?: string }>, note = "Tersimpan.") =>
    start(async () => {
      setStatus({});
      const r = await fn();
      setStatus(r.error ? { error: r.error } : { note });
    });
  const message = status.error ? (
    <p className="text-sm text-red-700">{status.error}</p>
  ) : status.note ? (
    <p className="text-sm text-brand-700">{status.note}</p>
  ) : null;
  return { pending, run, message, fail: (error: string) => setStatus({ error }) };
}

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
const cell = (projectId: number, weekday: number) => `${projectId}-${weekday}`;
const formatWib = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " WIB";

export function RosterClient({ agents, projects, accounts }: { agents: RosterAgent[]; projects: ProjectOption[]; accounts: Account[] }) {
  return (
    <div className="space-y-6">
      {agents.length === 0 && <p className="text-sm text-slate-600">Belum ada sales di roster.</p>}
      {agents.map((a) => (
        <AgentCard key={a.id} agent={a} projects={projects} accounts={accounts.filter((x) => !x.linked || x.id === a.staffUserId)} />
      ))}
      <NewAgentForm projects={projects} accounts={accounts.filter((x) => !x.linked)} />
    </div>
  );
}

function AccountSelect({ value, onChange, accounts }: { value: string; onChange: (v: string) => void; accounts: Account[] }) {
  return (
    <select className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Belum terhubung</option>
      {accounts.map((x) => (
        <option key={x.id} value={x.id}>
          {x.label}
        </option>
      ))}
    </select>
  );
}

function Coverage({ projects, value, onChange }: { projects: ProjectOption[]; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <fieldset>
      <legend className="text-sm">Proyek yang dicakup</legend>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {projects.map((p) => (
          <label key={p.id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={value.includes(p.id)} onChange={() => onChange(toggle(value, p.id))} />
            {p.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NewAgentForm({ projects, accounts }: { projects: ProjectOption[]; accounts: Account[] }) {
  const { pending, run, message } = useAction();
  const blank = { name: "", waPhone: "", staffUserId: "", projectIds: [] as number[] };
  const [f, setF] = useState(blank);
  return (
    <form
      className="space-y-3 rounded-lg bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await createAgentAction({ name: f.name, waPhone: f.waPhone, staffUserId: orNull(f.staffUserId), projectIds: f.projectIds });
          if (!r.error) setF(blank);
          return r;
        }, "Sales ditambahkan.");
      }}
    >
      <h2 className="font-semibold">Tambah sales</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          Nama
          <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </label>
        <label className="text-sm">
          WhatsApp
          <input className={input} value={f.waPhone} placeholder="0812…" onChange={(e) => setF({ ...f, waPhone: e.target.value })} required />
        </label>
        <label className="text-sm">
          Akun dashboard
          <AccountSelect value={f.staffUserId} onChange={(v) => setF({ ...f, staffUserId: v })} accounts={accounts} />
        </label>
      </div>
      <Coverage projects={projects} value={f.projectIds} onChange={(projectIds) => setF({ ...f, projectIds })} />
      {message}
      <button type="submit" disabled={pending} className={button}>
        Tambah sales
      </button>
    </form>
  );
}

function AgentCard({ agent, projects, accounts }: { agent: RosterAgent; projects: ProjectOption[]; accounts: Account[] }) {
  const profile = useAction();
  const [f, setF] = useState({
    name: agent.name,
    waPhone: agent.waPhone,
    staffUserId: agent.staffUserId ?? "",
    projectIds: agent.projectIds,
  });

  return (
    <section className={`space-y-4 rounded-lg bg-white p-4 shadow-sm ${agent.active ? "" : "opacity-75"}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{agent.name}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={agent.active}
            disabled={profile.pending}
            onChange={(e) => profile.run(() => updateAgentAction(agent.id, { active: e.target.checked }))}
          />
          Aktif
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          Nama
          <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="text-sm">
          WhatsApp
          <input className={input} value={f.waPhone} onChange={(e) => setF({ ...f, waPhone: e.target.value })} />
        </label>
        <label className="text-sm">
          Akun dashboard
          <AccountSelect value={f.staffUserId} onChange={(v) => setF({ ...f, staffUserId: v })} accounts={accounts} />
        </label>
      </div>
      <Coverage projects={projects} value={f.projectIds} onChange={(projectIds) => setF({ ...f, projectIds })} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={profile.pending}
          className={button}
          onClick={() =>
            profile.run(() =>
              updateAgentAction(agent.id, { name: f.name, waPhone: f.waPhone, staffUserId: orNull(f.staffUserId), projectIds: f.projectIds })
            )
          }
        >
          Simpan
        </button>
        {profile.message}
      </div>

      <Hours agent={agent} projects={projects.filter((p) => agent.projectIds.includes(p.id))} />
      <TimeOff agent={agent} />
    </section>
  );
}

function Hours({ agent, projects }: { agent: RosterAgent; projects: ProjectOption[] }) {
  const { pending, run, message, fail } = useAction();
  const [grid, setGrid] = useState<Record<string, { start: string; end: string }>>(() =>
    Object.fromEntries(agent.availability.map((r) => [cell(r.projectId, r.weekday), { start: r.start, end: r.end }]))
  );
  const set = (key: string, part: "start" | "end", value: string) =>
    setGrid((g) => ({ ...g, [key]: { start: g[key]?.start ?? "", end: g[key]?.end ?? "", [part]: value } }));

  const save = () => {
    const rows: AvailabilityRow[] = [];
    for (const p of projects) {
      for (let weekday = 1; weekday <= 7; weekday++) {
        const { start = "", end = "" } = grid[cell(p.id, weekday)] ?? {};
        if (!start && !end) continue;
        if (!start || !end || start >= end) return fail(`Jam ${DAYS[weekday - 1]} di ${p.name}: isi mulai dan selesai, mulai harus sebelum selesai.`);
        rows.push({ projectId: p.id, weekday, start, end });
      }
    }
    run(() => saveAvailabilityAction(agent.id, rows));
  };

  if (projects.length === 0) return <p className="text-sm text-slate-600">Pilih dan simpan proyek yang dicakup untuk mengisi jam kerja.</p>;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Jam kerja mingguan (WIB, kosongkan jika libur)</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <table key={p.id} className="text-sm">
            <caption className="pb-1 text-left font-medium">{p.name}</caption>
            <tbody>
              {DAYS.map((day, i) => {
                const key = cell(p.id, i + 1);
                return (
                  <tr key={day}>
                    <td className="w-20 py-0.5">{day}</td>
                    <td className="pr-2">
                      <input type="time" aria-label={`${day} mulai ${p.name}`} className={input} value={grid[key]?.start ?? ""} onChange={(e) => set(key, "start", e.target.value)} />
                    </td>
                    <td>
                      <input type="time" aria-label={`${day} selesai ${p.name}`} className={input} value={grid[key]?.end ?? ""} onChange={(e) => set(key, "end", e.target.value)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} className={button} onClick={save}>
          Simpan jam kerja
        </button>
        {message}
      </div>
    </div>
  );
}

function TimeOff({ agent }: { agent: RosterAgent }) {
  const { pending, run, message } = useAction();
  const [f, setF] = useState({ startsAt: "", endsAt: "", reason: "" });
  // datetime-local has no zone; the team works in WIB.
  const wib = (v: string) => `${v}:00+07:00`;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Cuti dan libur mendatang</h3>
      {agent.timeOff.length === 0 && <p className="text-sm text-slate-600">Tidak ada.</p>}
      <ul className="space-y-1 text-sm">
        {agent.timeOff.map((t) => (
          <li key={t.id} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1">
            <span>
              {formatWib(t.startsAt)} – {formatWib(t.endsAt)}
              {t.reason && ` · ${t.reason}`}
            </span>
            <button type="button" disabled={pending} className={link} onClick={() => run(() => deleteTimeOffAction(t.id), "Dihapus.")}>
              Hapus
            </button>
          </li>
        ))}
      </ul>
      <form
        className="grid items-end gap-2 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await addTimeOffAction(agent.id, { startsAt: wib(f.startsAt), endsAt: wib(f.endsAt), reason: f.reason.trim() || null });
            if (!r.error) setF({ startsAt: "", endsAt: "", reason: "" });
            return r;
          }, "Cuti ditambahkan.");
        }}
      >
        <label className="text-sm">
          Mulai
          <input type="datetime-local" className={input} value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required />
        </label>
        <label className="text-sm">
          Selesai
          <input type="datetime-local" className={input} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} required />
        </label>
        <label className="text-sm">
          Alasan
          <input className={input} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </label>
        <button type="submit" disabled={pending} className={button}>
          Tambah cuti
        </button>
      </form>
      {message}
    </div>
  );
}
