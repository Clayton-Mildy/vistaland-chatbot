"use client";

import { useEffect, useState } from "react";
import { subscribePushAction, unsubscribePushAction } from "@/actions/pushActions";
import { urlBase64ToUint8Array } from "@/lib/push";

type State = "checking" | "unsupported" | "off" | "on" | "busy";

export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function enable() {
    setState("busy");
    setError(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setError("Izin notifikasi ditolak di browser.");
        setState("off");
        return;
      }
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const json = sub.toJSON();
      const result = await subscribePushAction({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      });
      if (result.error) {
        await sub.unsubscribe();
        setError(result.error);
        setState("off");
        return;
      }
      setState("on");
    } catch {
      setError("Browser ini tidak bisa mengaktifkan notifikasi.");
      setState("off");
    }
  }

  async function disable() {
    setState("busy");
    setError(null);
    try {
      const sub = await (await navigator.serviceWorker.getRegistration("/sw.js"))?.pushManager.getSubscription();
      if (sub) {
        await unsubscribePushAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Gagal mematikan notifikasi.");
      setState("on");
    }
  }

  if (state === "unsupported" || state === "checking") return null;
  const on = state === "on";
  return (
    <div>
      <button
        type="button"
        disabled={state === "busy"}
        onClick={on ? disable : enable}
        title={on ? "Klik untuk mematikan notifikasi di browser ini" : undefined}
        className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-200 disabled:opacity-50"
      >
        {on ? "Notifikasi aktif" : "Aktifkan notifikasi"}
      </button>
      {error && <p className="px-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
