import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { upsertProjectBySlug, listProjects } from '../src/repositories/projects.js';

beforeEach(() => truncate('projects'));

it('upsertProjectBySlug inserts then updates the same row', async () => {
  const a = await upsertProjectBySlug({ slug: 'zetira', displayName: 'Zetira', personaTeamName: 'tim Zetira', locationLabel: 'Cibitung', vlesProjectId: 5, vlesAreaIds: [37] });
  const b = await upsertProjectBySlug({ slug: 'zetira', displayName: 'Zetira', personaTeamName: 'tim Zetira', locationLabel: 'Cibitung', vlesProjectId: 5, vlesAreaIds: [37, 99] });
  expect(b.id).toBe(a.id);
  expect(b.vlesAreaIds).toEqual([37, 99]);
  expect((await listProjects()).length).toBe(1);
});
