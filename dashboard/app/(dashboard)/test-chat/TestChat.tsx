"use client";

import { useState, useTransition } from "react";
import { resetTestChatAction, sendTestMessageAction } from "@/actions/testChatActions";
import { STAGE_LABEL } from "@/lib/api/leads";
import type { TestChatResult, TraceEntry } from "@/lib/api/testChat";

type Bubble = { from: "me" | "moni" | "note"; kind: string; text: string; link?: string };

const OUTCOME_NOTE: Partial<Record<TestChatResult["outcome"], string>> = {
  no_reply: "Moni memilih tidak membalas.",
  skipped: "Moni tidak membalas: chat sedang diserahkan ke tim atau Moni dimatikan. Klik Mulai ulang untuk mencoba lagi.",
};

export function TestChat() {
  const [pending, start] = useTransition();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [traces, setTraces] = useState<TraceEntry[][]>([]);
  const [lead, setLead] = useState<TestChatResult["lead"]>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    setError(null);
    setBubbles((b) => [...b, { from: "me", kind: "text", text: t }]);
    start(async () => {
      const r = await sendTestMessageAction(t);
      if (!r.data) return setError(r.error ?? "Gagal.");
      const d = r.data;
      const out: Bubble[] = d.outbound.map((o) =>
        o.kind === "text" ? { from: "moni", kind: "text", text: o.body ?? "" } : { from: "moni", kind: o.kind, text: decodeURIComponent(o.link?.split("/").pop() ?? o.kind), link: o.link }
      );
      if (d.outcome === "failed") out.push({ from: "note", kind: "text", text: `Moni gagal menjawab (${d.failure ?? "?"}). Di WhatsApp, chat ini akan diserahkan ke tim.` });
      else if (OUTCOME_NOTE[d.outcome]) out.push({ from: "note", kind: "text", text: OUTCOME_NOTE[d.outcome]! });
      setBubbles((b) => [...b, ...out]);
      setTraces((tr) => [...tr, d.trace]);
      setLead(d.lead);
    });
  }

  function reset() {
    start(async () => {
      const r = await resetTestChatAction();
      if (r.error) return setError(r.error);
      setBubbles([]);
      setTraces([]);
      setLead(null);
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="flex h-[70vh] flex-col rounded-lg bg-[#efeae2] shadow-sm">
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {bubbles.map((b, i) =>
            b.from === "note" ? (
              <p key={i} className="mx-auto max-w-[80%] rounded bg-amber-50 px-3 py-1 text-center text-xs text-amber-900">{b.text}</p>
            ) : (
              <div key={i} className={`flex ${b.from === "me" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${b.from === "me" ? "bg-[#d9fdd3]" : "bg-white"}`}>
                  {b.link ? (
                    <a href={b.link} target="_blank" rel="noreferrer" className="block">
                      <span className="text-xs uppercase text-slate-500">{b.kind}</span>
                      <span className="block font-medium text-brand-700">{b.text}</span>
                    </a>
                  ) : (
                    <p className="whitespace-pre-wrap">{b.text}</p>
                  )}
                </div>
              </div>
            )
          )}
          {pending && <p className="text-xs text-slate-500">Moni sedang mengetik…</p>}
        </div>
        <form className="flex gap-2 border-t border-slate-300 bg-white p-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input className="h-10 flex-1 rounded border border-slate-300 px-3 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tulis pesan sebagai pelanggan" disabled={pending} />
          <button type="submit" disabled={pending || !text.trim()} className="h-10 rounded bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-60">Kirim</button>
          <button type="button" disabled={pending} onClick={reset} className="h-10 rounded border border-slate-300 px-3 text-sm">Mulai ulang</button>
        </form>
        {error && <p className="px-3 pb-2 text-sm text-red-700">{error}</p>}
      </section>
      <aside className="space-y-4">
        <section className="rounded-lg bg-white p-4 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold">Lead uji</h2>
          {lead ? (
            <ul className="space-y-0.5">
              <li>Tahap: {STAGE_LABEL[lead.stage]}</li>
              <li>Nama: {lead.name ?? "—"}</li>
              <li>Budget: {lead.budgetPrice ?? "—"} · Cicilan: {lead.budgetMonthly ?? "—"}</li>
              <li>Kamar: {lead.bedroomsWanted ?? "—"} · Waktu: {lead.timeline ?? "—"}</li>
              <li>Kanal: {lead.sourceChannel ?? "—"}{lead.sourceRef ? ` (${lead.sourceRef})` : ""}</li>
              {lead.concerns.length > 0 && <li>Keraguan: {lead.concerns.join("; ")}</li>}
            </ul>
          ) : (
            <p className="text-slate-500">Belum ada pesan.</p>
          )}
        </section>
        <details className="rounded-lg bg-white p-4 text-sm shadow-sm" open>
          <summary className="cursor-pointer font-semibold">Langkah Moni</summary>
          <ol className="mt-2 space-y-2">
            {traces.map((turn, i) => (
              <li key={i}>
                <div className="text-xs font-semibold text-slate-500">Giliran {i + 1}</div>
                {turn.map((t, j) => (
                  <details key={j} className={`ml-2 ${t.isError ? "text-red-700" : ""}`}>
                    <summary className="cursor-pointer font-mono text-xs">{t.tool}{t.isError ? " (error)" : ""}</summary>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap bg-slate-50 p-2 text-[11px]">{JSON.stringify(t.input, null, 1)}{"\n→ "}{t.output}</pre>
                  </details>
                ))}
              </li>
            ))}
          </ol>
        </details>
      </aside>
    </div>
  );
}
