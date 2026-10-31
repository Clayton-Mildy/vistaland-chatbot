import { TestChat } from "./TestChat";

export default function TestChatPage() {
  return (
    <div className="max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Uji Chat</h1>
        <p className="text-sm text-slate-600">
          Chat dengan Moni seperti pelanggan. Tidak ada yang dikirim ke WhatsApp, dan lead uji tidak masuk daftar Leads. Ketik tag iklan
          di pesan pertama untuk mensimulasikan kanal, contoh <code>[ZTR-REELS] Halo</code>.
        </p>
      </div>
      <TestChat />
    </div>
  );
}
