import { asc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { projects } from '../db/schema/index.js';

export type Project = typeof projects.$inferSelect;

export type ProjectSeed = {
  slug: string;
  displayName: string;
  personaTeamName: string;
  locationLabel: string | null;
  vlesProjectId: number;
  vlesAreaIds: number[];
};

export async function listProjects(): Promise<Project[]> {
  return getDb().select().from(projects).orderBy(asc(projects.id));
}

export async function upsertProjectBySlug(input: ProjectSeed): Promise<Project> {
  const values = {
    slug: input.slug,
    displayName: input.displayName,
    personaTeamName: input.personaTeamName,
    locationLabel: input.locationLabel,
    vlesProjectId: input.vlesProjectId,
    vlesAreaIds: input.vlesAreaIds,
  };
  const [row] = await getDb()
    .insert(projects)
    .values(values)
    .onConflictDoUpdate({ target: projects.slug, set: { ...values, updatedAt: new Date() } })
    .returning();
  if (!row) throw new Error(`Failed to upsert project ${input.slug}`);
  return row;
}
