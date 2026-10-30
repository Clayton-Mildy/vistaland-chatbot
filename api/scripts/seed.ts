/**
 * Idempotent seed: the projects Moni sells and their VLES mapping, the first FLOW MONI prompt version
 * (only while none exists), then the first dashboard admin (only while no staff exist). Safe to re-run.
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
import { countStaff, createStaff } from '../src/repositories/staff.js';
import { listPromptVersions, savePromptVersion } from '../src/repositories/promptVersions.js';
import { FLOW_MONI } from '../src/agent/prompts/flowMoni.js';

const PROJECTS: ProjectSeed[] = [
  { slug: 'zetira', displayName: 'Zetira', personaTeamName: 'tim Zetira', locationLabel: 'Cibitung', vlesProjectId: 5, vlesAreaIds: [37] },
  { slug: 'gran-harmoni-cibitung', displayName: 'Gran Harmoni Cibitung', personaTeamName: 'tim Gran Harmoni Cibitung', locationLabel: 'Cibitung', vlesProjectId: 5, vlesAreaIds: [5] },
  { slug: 'grand-harmoni-park', displayName: 'Grand Harmoni Park', personaTeamName: 'tim Grand Harmoni Park', locationLabel: null, vlesProjectId: 25, vlesAreaIds: [25] },
];

for (const p of PROJECTS) {
  const row = await upsertProjectBySlug(p);
  console.log(`project ${row.id} ${row.slug} -> VLES project ${row.vlesProjectId}, areas [${row.vlesAreaIds.join(', ')}]`);
}

if ((await listPromptVersions(1)).length === 0) {
  const v = await savePromptVersion(FLOW_MONI, null);
  console.log(`Prompt version ${v.id} seeded from FLOW MONI`);
}

if ((await countStaff()) > 0) {
  console.log('Admin already exists, skipped');
} else {
  const email = process.env['SEED_ADMIN_EMAIL'] ?? '';
  const password = process.env['SEED_ADMIN_PASSWORD'] ?? '';
  if (!email || password.length < 12) {
    console.error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 12 chars) are required for the first admin');
    await closeDb();
    process.exit(1);
  }
  const admin = await createStaff({
    email,
    password,
    displayName: process.env['SEED_ADMIN_NAME'] || 'Admin',
    role: 'admin',
  });
  console.log(`Admin created: ${admin.email}`);
}

await closeDb();
