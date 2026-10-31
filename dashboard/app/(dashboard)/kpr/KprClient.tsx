"use client";

import { useState, useTransition } from "react";
import { saveKprSettingsAction, saveSchemeOverrideAction } from "@/actions/kprActions";
import type { Project } from "@/lib/api/catalog";
import type { KprSettings, MortgageBank, SchemeName } from "@/lib/api/kpr";

const input = "h-9 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-600 focus:outline-none";
const link = "text-sm text-brand-700 hover:underline disabled:opacity-60";
const numbers = (s: string) => s.split(",").map((x) => Number(x.trim().replace(",", "."))).filter((x) => Number.isFinite(x) && x > 0);

function SettingsRow({ project, row, label }: { project: Project; row: KprSettings; label: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; note?: string }>({});
  const [f, setF] = useState({
    fixedRatePct: String(row.fixedRatePct),
    fixedYears: String(row.fixedYears),
    floatingRatePct: String(row.floatingRatePct),
    tenorOptions: row.tenorOptions.join(", "),
    dpOptionsPct: row.dpOptionsPct.join(", "),
    notes: row.notes ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = () =>
    start(async () => {
      const r = await saveKprSettingsAction({
        projectId: project.id,
        bankId: row.bankId,
        fixedRatePct: Number(f.fixedRatePct),
        fixedYears: Number(f.fixedYears),
        floatingRatePct: Number(f.floatingRatePct),
        tenorOptions: numbers(f.tenorOptions).map(Math.round),
        dpOptionsPct: f.dpOptionsPct.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0),
        notes: f.notes.trim() || null,
      });
      setMsg(r.error ? { error: r.error } : { note: "Tersimpan." });
    });
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="py-2 pr-2 font-medium">{label}</td>
      <td className="w-20 py-2 pr-2"><input className={input} type="number" step="0.01" value={f.fixedRatePct} onChange={set("fixedRatePct")} /></td>
      <td className="w-20 py-2 pr-2"><input className={input} type="number" value={f.fixedYears} onChange={set("fixedYears")} /></td>
      <td className="w-20 py-2 pr-2"><input className={input} type="number" step="0.01" value={f.floatingRatePct} onChange={set("floatingRatePct")} /></td>
      <td className="py-2 pr-2"><input className={input} value={f.tenorOptions} onChange={set("tenorOptions")} placeholder="10, 15, 20" /></td>
      <td className="py-2 pr-2"><input className={input} value={f.dpOptionsPct} onChange={set("dpOptionsPct")} placeholder="5" /></td>
      <td className="py-2 pr-2"><input className={input} value={f.notes} onChange={set("notes")} /></td>
      <td className="py-2">
        <button type="button" className={link} disabled={pending} onClick={save}>Simpan</button>
        {msg.error && <p className="text-xs text-red-700">{msg.error}</p>}
        {msg.note && <p className="text-xs text-brand-700">{msg.note}</p>}
      </td>
    </tr>
  );
}

const blank = (projectId: number, bankId: number | null, base?: KprSettings): KprSettings => ({
  projectId,
  bankId,
  fixedRatePct: base?.fixedRatePct ?? 5,
  fixedYears: base?.fixedYears ?? 3,
  floatingRatePct: base?.floatingRatePct ?? 11,
  tenorOptions: base?.tenorOptions ?? [10, 15, 20],
  dpOptionsPct: base?.dpOptionsPct ?? [5],
  notes: null,
});

export function KprProjectCard({ project, settings, banks }: { project: Project; settings: KprSettings[]; banks: MortgageBank[] }) {
  const def = settings.find((s) => s.bankId === null);
  const [extraBanks, setExtraBanks] = useState<number[]>([]);
  const bankRows = [...settings.filter((s) => s.bankId !== null), ...extraBanks.map((id) => blank(project.id, id, def))];
  const bankName = (id: number | null) => banks.find((b) => b.bankId === id)?.bankName ?? `Bank ${id}`;
  const addable = banks.filter((b) => !bankRows.some((r) => r.bankId === b.bankId));
  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="font-semibold">{project.displayName}</h2>
      {!def && <p className="text-sm text-amber-700">Belum ada asumsi standar — Moni belum bisa memberi simulasi untuk proyek ini.</p>}
      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr><th>Berlaku untuk</th><th>Bunga tetap %</th><th>Lama (th)</th><th>Floating %</th><th>Tenor (th)</th><th>DP %</th><th>Catatan</th><th /></tr>
        </thead>
        <tbody>
          <SettingsRow project={project} row={def ?? blank(project.id, null)} label="Standar proyek" />
          {bankRows.map((r) => <SettingsRow key={r.bankId} project={project} row={r} label={bankName(r.bankId)} />)}
        </tbody>
      </table>
      {addable.length > 0 && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          Tambah asumsi khusus bank:
          <select className="h-8 rounded border border-slate-300 px-2" value="" onChange={(e) => e.target.value && setExtraBanks([...extraBanks, Number(e.target.value)])}>
            <option value="">Pilih bank</option>
            {addable.map((b) => <option key={b.bankId} value={b.bankId}>{b.bankName ?? `Bank ${b.bankId}`}{b.branchName ? ` (${b.branchName})` : ""}</option>)}
          </select>
        </label>
      )}
    </section>
  );
}

function SchemeRow({ s }: { s: SchemeName }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(s.overrideDpPct?.toString() ?? "");
  const [note, setNote] = useState<string | null>(null);
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1.5 pr-2">{s.name}</td>
      <td className="pr-2">{s.units}</td>
      <td className="pr-2">{s.parsedDpPct === null ? "—" : `${s.parsedDpPct}%`}</td>
      <td className="w-24 pr-2"><input className={input} type="number" min={0} max={100} step="0.1" value={value} onChange={(e) => setValue(e.target.value)} /></td>
      <td>
        <button
          type="button"
          className={link}
          disabled={pending || value === ""}
          onClick={() => start(async () => setNote((await saveSchemeOverrideAction(s.name, Number(value))).error ?? "Tersimpan."))}
        >
          Simpan
        </button>
        {note && <span className="ml-2 text-xs text-slate-600">{note}</span>}
      </td>
    </tr>
  );
}

export function SchemeTable({ schemes }: { schemes: SchemeName[] }) {
  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Skema pembayaran VLES</h2>
      <p className="text-sm text-slate-600">DP dibaca dari nama skema ("KPR 95%" berarti DP 5%). Isi DP khusus jika nama skema tidak menyebutnya.</p>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500"><tr><th>Nama skema</th><th>Unit</th><th>DP dari nama</th><th>DP khusus %</th><th /></tr></thead>
        <tbody>{schemes.map((s) => <SchemeRow key={s.name} s={s} />)}</tbody>
      </table>
    </section>
  );
}
