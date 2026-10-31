"use client";

import { useState, useTransition } from "react";
import { aiAction, patchLeadAction, sendStaffMessageAction, takeoverAction } from "@/actions/leadActions";
import { STAGES, STAGE_LABEL, type LeadDetail, type LeadPatch, type Stage } from "@/lib/api/leads";
import { formatWib } from "@/lib/format";

const input = "h-8 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-600 focus:outline-none";

export function LeadControls({ detail }: { detail: LeadDetail }) {
  const { lead, conversation } = detail;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; note?: string }>({});
  const [reply, setReply] = useState("");
  const [f, setF] = useState({
    name: lead.name ?? "",
    budgetPrice: lead.budgetPrice?.toString() ?? "",
    budgetMonthly: lead.budgetMonthly?.toString() ?? "",
    dpBudget: lead.dpBudget?.toString() ?? "",
    bedroomsWanted: lead.bedroomsWanted?.toString() ?? "",
    purpose: lead.purpose ?? "",
    timeline: lead.timeline ?? "",
    domicileArea: lead.domicileArea ?? "",
    hotCold: lead.hotCold ?? "",
    stage: lead.stage,
  });
  const run = (fn: () => Promise<{ error?: string }>, note: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { error: r.error } : { note });
      if (!r.error) after?.();
    });
  const takeoverUntil = conversation?.humanTakeoverUntil ? new Date(conversation.humanTakeoverUntil) : null;
  const underTakeover = takeoverUntil !== null && takeoverUntil.getTime() > Date.now();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  function save() {
    const num = (v: string) => (v.trim() ? Number(v) : undefined);
    const text = (v: string) => (v.trim() ? v.trim() : undefined);
    const patch: LeadPatch = {
      name: text(f.name),
      budgetPrice: num(f.budgetPrice),
      budgetMonthly: num(f.budgetMonthly),
      dpBudget: num(f.dpBudget),
      bedroomsWanted: num(f.bedroomsWanted),
      purpose: (f.purpose || undefined) as LeadPatch["purpose"],
      timeline: text(f.timeline),
      domicileArea: text(f.domicileArea),
      hotCold: (f.hotCold || undefined) as LeadPatch["hotCold"],
      stage: f.stage !== lead.stage ? (f.stage as Stage) : undefined,
    };
    run(() => patchLeadAction(lead.id, patch), "Data lead tersimpan.");
  }

  return (
    <>
      <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={conversation?.aiEnabled ?? false} disabled={pending || !conversation} onChange={(e) => run(() => aiAction(lead.id, e.target.checked), e.target.checked ? "Moni aktif untuk chat ini." : "Moni dimatikan untuk chat ini.")} />
            Moni aktif
          </label>
          <button
            type="button"
            disabled={pending || !conversation}
            onClick={() => run(() => takeoverAction(lead.id, !underTakeover), underTakeover ? "Chat dikembalikan ke Moni." : "Chat diambil alih.")}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
          >
            {underTakeover ? "Kembalikan ke Moni" : "Ambil alih"}
          </button>
        </div>
        {underTakeover && <p className="text-xs text-slate-600">Diambil alih sampai {formatWib(takeoverUntil!)}</p>}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) run(() => sendStaffMessageAction(lead.id, reply), "Pesan terkirim. Moni berhenti membalas chat ini sementara.", () => setReply(""));
          }}
        >
          <textarea className="w-full rounded border border-slate-300 p-2 text-sm" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Balas sebagai staf" />
          <button type="submit" disabled={pending || !reply.trim()} className="h-8 rounded bg-brand-600 px-3 text-sm font-semibold text-white disabled:opacity-60">Kirim</button>
        </form>
        {msg.error && <p className="text-sm text-red-700">{msg.error}</p>}
        {msg.note && <p className="text-sm text-brand-700">{msg.note}</p>}
      </section>

      <section className="space-y-2 rounded-lg bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Data lead</h2>
        <label className="block text-xs">Tahap
          <select className={input} value={f.stage} onChange={set("stage")}>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">Nama<input className={input} value={f.name} onChange={set("name")} /></label>
          <label className="text-xs">Suhu
            <select className={input} value={f.hotCold} onChange={set("hotCold")}>
              <option value="">—</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
            </select>
          </label>
          <label className="text-xs">Budget harga (Rp)<input className={input} type="number" value={f.budgetPrice} onChange={set("budgetPrice")} /></label>
          <label className="text-xs">Cicilan/bulan (Rp)<input className={input} type="number" value={f.budgetMonthly} onChange={set("budgetMonthly")} /></label>
          <label className="text-xs">Dana awal (Rp)<input className={input} type="number" value={f.dpBudget} onChange={set("dpBudget")} /></label>
          <label className="text-xs">Kamar tidur<input className={input} type="number" value={f.bedroomsWanted} onChange={set("bedroomsWanted")} /></label>
          <label className="text-xs">Tujuan
            <select className={input} value={f.purpose} onChange={set("purpose")}>
              <option value="">—</option><option value="own_use">Ditempati</option><option value="investment">Investasi</option>
            </select>
          </label>
          <label className="text-xs">Domisili<input className={input} value={f.domicileArea} onChange={set("domicileArea")} /></label>
          <label className="col-span-2 text-xs">Waktu / jadwal yang diminta<input className={input} value={f.timeline} onChange={set("timeline")} /></label>
        </div>
        {lead.concerns.length > 0 && <p className="text-xs text-slate-600">Keraguan: {lead.concerns.join("; ")}</p>}
        <p className="text-xs text-slate-600">Sumber: {lead.sourceChannel ?? "—"}{lead.sourceRef ? ` · ${lead.sourceRef}` : ""}</p>
        <button type="button" disabled={pending} onClick={save} className="h-8 rounded bg-brand-600 px-3 text-sm font-semibold text-white disabled:opacity-60">Simpan</button>
      </section>
    </>
  );
}
