import { VISIT_STATUS_LABEL, type HandoverSummary } from "@/lib/api/leads";

function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <p>
      <span className="text-xs text-slate-500">{label}</span>
      <br />
      {value ?? "—"}
    </p>
  );
}

/** The step-9 handover summary for a sales person: shared by the lead page and the visit page. */
export function SummaryCard({ summary }: { summary: HandoverSummary }) {
  return (
    <section className="space-y-1 rounded-lg bg-white p-4 text-sm shadow-sm">
      <h2 className="font-semibold">Ringkasan untuk sales</h2>
      <SummaryRow label="Sumber" value={summary.source} />
      <SummaryRow label="Domisili" value={summary.location} />
      <SummaryRow label="Tujuan" value={summary.purpose} />
      <SummaryRow label="Kebutuhan" value={summary.need} />
      <SummaryRow label="Budget" value={summary.budget} />
      <SummaryRow label="Keraguan" value={summary.concerns.join("; ") || null} />
      <SummaryRow label="Materi" value={summary.materials.join(", ") || null} />
      <SummaryRow label="Simulasi" value={summary.simulations.join("; ") || null} />
      <SummaryRow label="Kunjungan" value={summary.visit ? `${summary.visit.label} · ${summary.visit.salesName} · ${VISIT_STATUS_LABEL[summary.visit.status] ?? summary.visit.status}` : null} />
      <SummaryRow label="Catatan" value={summary.notes} />
    </section>
  );
}
