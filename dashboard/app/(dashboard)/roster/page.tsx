import { listProjects } from "@/lib/api/catalog";
import { listRoster } from "@/lib/api/roster";
import { listStaff } from "@/lib/api/staff";
import { RosterClient } from "./RosterClient";

export const dynamic = "force-dynamic";

export default async function RosterPage() {
  const [agents, projects, staff] = await Promise.all([listRoster(), listProjects(), listStaff()]);
  const linked = new Set(agents.map((a) => a.staffUserId));
  // Sales accounts not yet linked; each agent's own account stays selectable on its card.
  const accounts = staff.filter((s) => s.role === "sales" && s.isActive).map((s) => ({ id: s.id, label: `${s.displayName} (${s.email})`, linked: linked.has(s.id) }));
  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Roster Sales</h1>
      <RosterClient
        agents={agents}
        projects={projects.map((p) => ({ id: p.id, name: p.active ? p.displayName : `${p.displayName} (nonaktif)` }))}
        accounts={accounts}
      />
    </div>
  );
}
