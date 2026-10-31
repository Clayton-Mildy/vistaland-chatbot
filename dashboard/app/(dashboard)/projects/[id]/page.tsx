import Link from "next/link";
import { notFound } from "next/navigation";
import { listChannelTags, listMaterials, listProjectTypes, listProjects, listPromos } from "@/lib/api/catalog";
import { MaterialsPanel, ProfileForm, PromosPanel, TagsPanel, TypesPanel } from "./ProjectTabs";

export const dynamic = "force-dynamic";

const TABS = [
  ["profil", "Profil"],
  ["tipe", "Tipe"],
  ["materi", "Materi"],
  ["promo", "Promo"],
  ["tag", "Tag iklan"],
] as const;

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab = "profil" } = await searchParams;
  const project = (await listProjects()).find((p) => p.id === Number(id));
  if (!project) notFound();

  let body: React.ReactNode;
  if (tab === "tipe") body = <TypesPanel project={project} types={await listProjectTypes(project.id)} />;
  else if (tab === "materi") body = <MaterialsPanel project={project} materials={await listMaterials(project.id)} types={await listProjectTypes(project.id)} />;
  else if (tab === "promo") body = <PromosPanel project={project} promos={await listPromos(project.id)} />;
  else if (tab === "tag") body = <TagsPanel project={project} tags={(await listChannelTags()).filter((t) => t.projectId === project.id)} />;
  else body = <ProfileForm project={project} />;

  return (
    <div className="max-w-5xl space-y-4">
      <p className="text-sm">
        <Link href="/projects" className="text-brand-700 hover:underline">
          ← Proyek & Materi
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{project.displayName}</h1>
      <nav className="flex gap-1 border-b border-slate-200">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/projects/${project.id}?tab=${key}`}
            className={`rounded-t px-3 py-2 text-sm ${tab === key ? "bg-white font-semibold" : "text-slate-600 hover:bg-slate-200"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="rounded-lg bg-white p-4 shadow-sm">{body}</div>
    </div>
  );
}
