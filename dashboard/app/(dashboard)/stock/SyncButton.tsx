"use client";

import { useState, useTransition } from "react";
import { triggerVlesSync } from "@/actions/stockActions";

export function SyncButton() {
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      {note && <span className="text-sm text-slate-600">{note}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await triggerVlesSync();
            setNote(r.error ?? (r.started ? "Sinkronisasi dimulai." : "Sinkronisasi sedang berjalan."));
          })
        }
        className="h-9 rounded bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        Sinkronkan sekarang
      </button>
    </div>
  );
}
