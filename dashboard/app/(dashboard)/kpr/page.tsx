import { listProjects } from "@/lib/api/catalog";
import { listKprSettings, listMortgageBanks, listSchemeNames } from "@/lib/api/kpr";
import { KprProjectCard, SchemeTable } from "./KprClient";

export const dynamic = "force-dynamic";

export default async function KprPage() {
  const projects = (await listProjects()).filter((p) => p.active);
  const cards = await Promise.all(
    projects.map(async (p) => ({ project: p, settings: await listKprSettings(p.id), banks: await listMortgageBanks(p.id) }))
  );
  const schemes = await listSchemeNames();
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Asumsi KPR</h1>
        <p className="text-sm text-slate-600">
          Moni memakai asumsi ini untuk simulasi cicilan. Tanpa asumsi, Moni tidak memberi simulasi untuk proyek tersebut.
        </p>
      </div>
      {cards.map((c) => (
        <KprProjectCard key={c.project.id} project={c.project} settings={c.settings} banks={c.banks} />
      ))}
      <SchemeTable schemes={schemes} />
    </div>
  );
}
