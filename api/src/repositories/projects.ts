import { asc, eq } from 'drizzle-orm';
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

export async function getProject(id: number): Promise<Project | null> {
  const [row] = await getDb().select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ?? null;
}

export type ProjectPatch = Partial<
  Pick<
    Project,
    | 'displayName'
    | 'personaTeamName'
    | 'locationLabel'
    | 'mapsUrl'
    | 'accessNotes'
    | 'galleryHours'
    | 'visitMinutes'
    | 'sameDayMinNoticeMinutes'
    | 'vlesAreaIds'
    | 'subsidiNotes'
    | 'active'
  >
>;

export async function updateProject(id: number, patch: ProjectPatch): Promise<Project | null> {
  if (Object.keys(patch).length === 0) return getProject(id);
  const [row] = await getDb()
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  return row ?? null;
}
