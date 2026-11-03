"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelVisitAction, freeSlotsAction, moveVisitAction, outcomeAction, reassignVisitAction } from "@/actions/visitActions";
import type { FreeSlot } from "@/lib/api/visits";

const input = "h-8 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-600 focus:outline-none";
const primary = "h-8 rounded bg-brand-600 px-3 text-sm font-semibold text-white disabled:opacity-60";
const secondary = "h-8 rounded border border-slate-300 px-3 text-sm hover:bg-slate-100 disabled:opacity-60";

type Panel = "move" | "reassign" | "cancel" | null;

const NOTICE_TEXT = {
  sent: "Konsumen sudah diberi tahu lewat WhatsApp.",
  queued: "Pemberitahuan ke konsumen masuk antrean pesan template.",
  none: "",
  failed: "Pemberitahuan ke konsumen gagal; kabari manual.",
} as const;

export function VisitActions({
  visitId,
  active,
  started,
  isAdmin,
  agents,
}: {
  visitId: string;
  // Still scheduled, confirmed or awaiting confirmation.
  active: boolean;
  // The visit's start time has passed.
  started: boolean;
  isAdmin: boolean;
  // Active agents covering the project, without the visit's current one.
  agents: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const [msg, setMsg] = useState<{ error?: string; note?: string }>({});
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<FreeSlot[] | null>(null);
  const [time, setTime] = useState("");
  const [agentId, setAgentId] = useState("");
  const [reason, setReason] = useState("");

  if (!active) return null;

  const open = (p: Panel) => {
    setPanel(panel === p ? null : p);
    setMsg({});
  };
  const run = (fn: () => Promise<{ error?: string }>, note: string, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      setMsg(r.error ? { error: r.error } : { note });
      if (!r.error) after?.();
    });

  function pickDate(value: string) {
    setDate(value);
    setTime("");
    setSlots(null);
    if (!value) return;
    startTransition(async () => {
      const r = await freeSlotsAction(visitId, value);
      if (r.error) setMsg({ error: r.error });
      else setSlots(r.slots ?? []);
    });
  }

  return (
    <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Tindakan</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || !started} onClick={() => run(() => outcomeAction(visitId, "visited"), "Kunjungan ditandai sudah datang.")} className={primary}>Sudah datang</button>
        <button type="button" disabled={pending || !started} onClick={() => run(() => outcomeAction(visitId, "no_show"), "Kunjungan ditandai tidak datang.")} className={secondary}>Tidak datang</button>
      </div>
      {!started && <p className="text-xs text-slate-500">Hasil kunjungan bisa dicatat setelah jam kunjungan dimulai.</p>}

      {isAdmin && (
        <>
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={() => open("move")} className={secondary}>Pindah jadwal</button>
            <button type="button" onClick={() => open("reassign")} className={secondary}>Alihkan sales</button>
            <button type="button" onClick={() => open("cancel")} className="h-8 rounded border border-red-300 px-3 text-sm text-red-700 hover:bg-red-50">Batalkan</button>
          </div>

          {panel === "move" && (
            <div className="space-y-2 rounded border border-slate-200 p-3">
              <label className="block text-xs">Tanggal baru
                <input type="date" className={input} value={date} onChange={(e) => pickDate(e.target.value)} />
              </label>
              {slots && (
                <label className="block text-xs">Jam kosong
                  <select className={input} value={time} onChange={(e) => setTime(e.target.value)}>
                    <option value="">{slots.length ? "Pilih jam" : "Tidak ada jam kosong"}</option>
                    {slots.map((s) => <option key={s.startsAt} value={s.time}>{s.time.replace(":", ".")} WIB</option>)}
                  </select>
                </label>
              )}
              <p className="text-xs text-slate-600">Pastikan konsumen sudah setuju. Konsumen tidak dikabari otomatis.</p>
              <button
                type="button"
                disabled={pending || !date || !time}
                className={primary}
                onClick={() =>
                  startTransition(async () => {
                    const r = await moveVisitAction(visitId, date, time);
                    if (r.error) return setMsg({ error: r.error });
                    setMsg({ note: "Jadwal dipindah." });
                    // Moving books a new visit row; show that one.
                    if (r.visitId) router.push(`/visits/${r.visitId}`);
                  })
                }
              >
                Pindah
              </button>
            </div>
          )}

          {panel === "reassign" && (
            <div className="space-y-2 rounded border border-slate-200 p-3">
              <label className="block text-xs">Sales baru
                <select className={input} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">{agents.length ? "Pilih sales" : "Tidak ada sales lain untuk proyek ini"}</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <p className="text-xs text-slate-600">Konsumen akan diberi tahu lewat WhatsApp siapa yang membantu.</p>
              <button
                type="button"
                disabled={pending || !agentId}
                className={primary}
                onClick={() =>
                  startTransition(async () => {
                    const r = await reassignVisitAction(visitId, agentId);
                    setMsg(r.error ? { error: r.error } : { note: `Sales dialihkan. ${NOTICE_TEXT[r.notice ?? "none"]}`.trim() });
                  })
                }
              >
                Alihkan
              </button>
            </div>
          )}

          {panel === "cancel" && (
            <div className="space-y-2 rounded border border-slate-200 p-3">
              <label className="block text-xs">Alasan pembatalan
                <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wajib diisi" />
              </label>
              <p className="text-xs text-slate-600">Pastikan konsumen sudah setuju. Konsumen tidak dikabari otomatis.</p>
              <button type="button" disabled={pending || !reason.trim()} className="h-8 rounded bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-60" onClick={() => run(() => cancelVisitAction(visitId, reason.trim()), "Kunjungan dibatalkan.")}>
                Batalkan kunjungan
              </button>
            </div>
          )}
        </>
      )}
      {msg.error && <p className="text-sm text-red-700">{msg.error}</p>}
      {msg.note && <p className="text-sm text-brand-700">{msg.note}</p>}
    </section>
  );
}
