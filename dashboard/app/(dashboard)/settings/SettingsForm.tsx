"use client";

import { useState, useTransition } from "react";
import { savePromptAction, saveSettingsAction } from "@/actions/settingsActions";
import type { AppSettings, PromptVersion, TemplateRef } from "@/lib/api/settings";
import { formatWib } from "@/lib/format";

const input = "h-9 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-600 focus:outline-none";
const button = "h-9 rounded bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60";

const SALES_ALERT_BODY = `Halo Kak {{1}}, ada update kunjungan: *{{2}}*.
Konsumen: {{3}}
Waktu: {{4}}
Proyek: {{5}}
Ringkasan: {{6}}
Detail: {{7}}`;

const REASSIGN_NOTICE_BODY = `Halo Kak {{1}}, untuk kunjungan Kakak nanti akan dibantu oleh Kak {{2}} dari tim sales kami ya 😊`;

function TemplateFields({ label, value, onChange }: { label: string; value: TemplateRef; onChange: (v: TemplateRef) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
      <label className="block text-sm">{label} (nama)
        <input className={input} value={value.name} placeholder="contoh: sales_alert_v1" onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </label>
      <label className="block text-sm">Bahasa
        <input className={input} value={value.language} placeholder="id" onChange={(e) => onChange({ ...value, language: e.target.value })} />
      </label>
    </div>
  );
}

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
        <h2 className="font-semibold">WhatsApp keluar</h2>
        <p className="text-sm text-slate-600">
          Pesan yang kita mulai sendiri (notifikasi ke sales, pemberitahuan ganti sales) harus memakai template yang sudah disetujui di ChakraHQ. Kirim kedua template di bawah ini, lalu isi namanya di sini. Selama nama kosong, pesan yang terkait tidak dikirim dan tetap menunggu.
        </p>
        <label className="block text-sm">Phone number ID ChakraHQ
          <input className={input} inputMode="numeric" value={f.chakraPhoneNumberId} onChange={(e) => setF({ ...f, chakraPhoneNumberId: e.target.value })} />
          <span className="text-xs text-slate-500">Nomor bisnis untuk pesan yang kita mulai. Kosong: pakai nomor percakapan konsumen.</span>
        </label>
        <TemplateFields label="Template notifikasi sales" value={f.salesAlertTemplate} onChange={(v) => setF({ ...f, salesAlertTemplate: v })} />
        <div className="text-xs text-slate-600">
          Isi template (kategori UTILITY, bahasa id):
          <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono">{SALES_ALERT_BODY}</pre>
        </div>
        <TemplateFields label="Template pemberitahuan ganti sales" value={f.reassignNoticeTemplate} onChange={(v) => setF({ ...f, reassignNoticeTemplate: v })} />
        <div className="text-xs text-slate-600">
          Isi template (kategori UTILITY, bahasa id):
          <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono">{REASSIGN_NOTICE_BODY}</pre>
        </div>
        <button
          type="button"
          disabled={pending}
          className={button}
          onClick={() =>
            run(
              () =>
                saveSettingsAction({
                  chakraPhoneNumberId: f.chakraPhoneNumberId.trim(),
                  salesAlertTemplate: { name: f.salesAlertTemplate.name.trim(), language: f.salesAlertTemplate.language.trim() },
                  reassignNoticeTemplate: { name: f.reassignNoticeTemplate.name.trim(), language: f.reassignNoticeTemplate.language.trim() },
                }),
              "Pengaturan WhatsApp keluar tersimpan."
            )
          }
        >
          Simpan WhatsApp keluar
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
