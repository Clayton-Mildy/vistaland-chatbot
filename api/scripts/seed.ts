/**
 * Idempotent seed: the projects Moni sells and their VLES mapping. Safe to re-run.
 *
 *   npm run db:seed                 (dev, from api/)
 *   node dist-scripts/seed.js       (container)
 *
 * VLES area ids were checked against the live API on 2026-10-30: area 37 is ZETIRA inside
 * VLES project 5 (Gran Harmoni Cibitung), area 5 is the rest of project 5, area 25 is
 * Grand Harmoni Park (project 25).
 */
import 'dotenv/config';
import { closeDb } from '../src/db/client.js';
import { upsertProjectBySlug, type ProjectSeed } from '../src/repositories/projects.js';

const PROJECTS: ProjectSeed[] = [
  { slug: 'zetira', displayName: 'Zetira', personaTeamName: 'tim Zetira', locationLabel: 'Cibitung', vlesProjectId: 5, vlesAreaIds: [37] },
  { slug: 'gran-harmoni-cibitung', displayName: 'Gran Harmoni Cibitung', personaTeamName: 'tim Gran Harmoni Cibitung', locationLabel: 'Cibitung', vlesProjectId: 5, vlesAreaIds: [5] },
  { slug: 'grand-harmoni-park', displayName: 'Grand Harmoni Park', personaTeamName: 'tim Grand Harmoni Park', locationLabel: null, vlesProjectId: 25, vlesAreaIds: [25] },
];

for (const p of PROJECTS) {
  const row = await upsertProjectBySlug(p);
  console.log(`project ${row.id} ${row.slug} -> VLES project ${row.vlesProjectId}, areas [${row.vlesAreaIds.join(', ')}]`);
}

await closeDb();
