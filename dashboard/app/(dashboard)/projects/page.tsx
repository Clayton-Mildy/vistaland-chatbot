import Link from "next/link";
import { listChannelTags, listMaterials, listProjectTypes, listProjects } from "@/lib/api/catalog";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const [projects, tags] = await Promise.all([listProjects(), listChannelTags()]);
  const rows = await Promise.all(
    projects.map(async (p) => {
      const [materials, types] = await Promise.all([listMaterials(p.id), listProjectTypes(p.id)]);
      return {
        p,
        materials: materials.filter((m) => m.active).length,
        types: types.length,
        typesWithoutRooms: types.filter((t) => t.profile?.bedrooms == null).length,
        tags: tags.filter((t) => t.projectId === p.id).length,
      };
    })
  );

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-2xl font-semibold">Proyek & Materi</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(({ p, materials, types, typesWithoutRooms, tags: tagCount }) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="block rounded-lg bg-white p-4 shadow-sm hover:ring-2 hover:ring-brand-600">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{p.displayName}</h2>
              {!p.active && <span className="rounded bg-slate-200 px-2 text-xs">Nonaktif</span>}
            </div>
            <p className="text-sm text-slate-600">
              {p.personaTeamName} · {p.locationLabel ?? "lokasi belum diisi"}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Proyek VLES {p.vlesProjectId}, area {p.vlesAreaIds.join(", ") || "—"}
            </p>
            <ul className="mt-2 space-y-0.5 text-sm">
              <li>{materials} materi aktif</li>
              <li>
                {types} tipe di VLES
                {typesWithoutRooms > 0 && <span className="text-amber-700"> · {typesWithoutRooms} belum diisi kamar tidur</span>}
              </li>
              <li>{tagCount} tag iklan</li>
            </ul>
          </Link>
        ))}
      </div>
    </div>
  );
}
