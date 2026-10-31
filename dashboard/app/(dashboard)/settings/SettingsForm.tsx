"use client";

import { useState, useTransition } from "react";
import { savePromptAction, saveSettingsAction } from "@/actions/settingsActions";
import type { AppSettings, PromptVersion } from "@/lib/api/settings";
import { formatWib } from "@/lib/format";

const input = "h-9 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-600 focus:outline-none";
const button = "h-9 rounded bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60";

export function SettingsForm({ settings, versions }: { settings: AppSettings; versions: (PromptVersion & { author: string })[] }) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({ ...settings, takeoverHours: String(settings.takeoverHours) });
  const [prompt, setPrompt] = useState(versions[0]?.text ?? "");
  const [msg, setMsg] = useState<{ error?: string; note?: string }>({});
  const run = (fn: () => Promise<{ error?: string }>, note: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { error: r.error } : { note });
    });

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={f.aiEnabled} onChange={(e) => setF({ ...f, aiEnabled: e.target.checked })} /> Moni aktif
          <span className="font-normal text-slate-500">(jika mati, pesan tetap tersimpan tetapi tidak ada yang dibalas Moni)</span>
        </label>
        <label className="block text-sm">Nama tim untuk proyek yang belum diketahui
          <input className={input} value={f.personaGroupName} onChange={(e) => setF({ ...f, personaGroupName: e.target.value })} />
        </label>
        <label className="block text-sm">Lama ambil alih (jam)
          <input className={input} type="number" min={1} max={168} value={f.takeoverHours} onChange={(e) => setF({ ...f, takeoverHours: e.target.value })} />
        </label>
        <button type="button" disabled={pending} className={button} onClick={() => run(() => saveSettingsAction({ aiEnabled: f.aiEnabled, personaGroupName: f.personaGroupName, takeoverHours: Number(f.takeoverHours) }), "Pengaturan tersimpan.")}>
          Simpan pengaturan
        </button>
      </section>
      <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Prompt FLOW MONI</h2>
        <p className="text-sm text-slate-600">Menyimpan membuat versi baru yang langsung dipakai Moni. Aturan keamanan (harga dari data, tanpa janji KPR) tetap berlaku di luar teks ini.</p>
        <textarea className="w-full rounded border border-slate-300 p-2 font-mono text-xs" rows={20} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <button type="button" disabled={pending || prompt.trim() === (versions[0]?.text ?? "").trim()} className={button} onClick={() => run(() => savePromptAction(prompt), "Versi prompt baru tersimpan.")}>
          Simpan sebagai versi baru
        </button>
        <ul className="space-y-1 text-sm">
          {versions.map((v, i) => (
            <li key={`${v.id}-${i}`} className="flex items-center justify-between">
              <span>Versi {v.id || "bawaan"} · {v.createdAt ? formatWib(v.createdAt) : "—"} · {v.author}{i === 0 && <span className="ml-1 text-brand-700">(dipakai)</span>}</span>
              {i > 0 && <button type="button" className="text-brand-700 hover:underline" onClick={() => setPrompt(v.text)}>Muat ke editor</button>}
            </li>
          ))}
        </ul>
      </section>
      {msg.error && <p className="text-sm text-red-700">{msg.error}</p>}
      {msg.note && <p className="text-sm text-brand-700">{msg.note}</p>}
    </div>
  );
}
