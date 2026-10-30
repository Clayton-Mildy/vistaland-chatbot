import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { createStaff, updateStaff } from '../src/repositories/staff.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };

beforeEach(() => truncate('staff_users'));

it('rejects missing and wrong secrets', async () => {
  const app = buildApp();
  expect((await app.inject({ method: 'GET', url: '/api/v1/staff' })).statusCode).toBe(401);
  expect((await app.inject({ method: 'GET', url: '/api/v1/staff', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
});

it('creates staff without exposing the hash, and refuses a duplicate email in any case', async () => {
  const app = buildApp();
  const body = { email: 'Sari@Vista.id', password: 'correct-horse-1', displayName: 'Sari', role: 'sales' };
  const res = await app.inject({ method: 'POST', url: '/api/v1/staff', headers: auth, payload: body });
  expect(res.statusCode).toBe(201);
  expect(res.json().data.email).toBe('sari@vista.id');
  expect(JSON.stringify(res.json())).not.toMatch(/hash/i);
  const dup = await app.inject({ method: 'POST', url: '/api/v1/staff', headers: auth, payload: { ...body, email: 'sari@vista.id' } });
  expect(dup.statusCode).toBe(409);
  expect(dup.json().error).toBe('EMAIL_TAKEN');
});

it('verify-credentials accepts the right password and refuses wrong or inactive', async () => {
  const app = buildApp();
  const url = '/api/v1/auth/verify-credentials';
  const s = await createStaff({ email: 'a@vista.id', password: 'correct-horse-1', displayName: 'A', role: 'admin' });
  const ok = await app.inject({ method: 'POST', url, headers: auth, payload: { email: 'A@vista.id', password: 'correct-horse-1' } });
  expect(ok.statusCode).toBe(200);
  expect(ok.json().data.role).toBe('admin');
  expect((await app.inject({ method: 'POST', url, headers: auth, payload: { email: 'a@vista.id', password: 'wrong-password' } })).statusCode).toBe(401);
  await updateStaff(s.id, { isActive: false });
  expect((await app.inject({ method: 'POST', url, headers: auth, payload: { email: 'a@vista.id', password: 'correct-horse-1' } })).statusCode).toBe(401);
});

it('rejects a role other than admin or sales', async () => {
  const res = await buildApp().inject({ method: 'POST', url: '/api/v1/staff', headers: auth, payload: { email: 'b@vista.id', password: 'correct-horse-1', displayName: 'B', role: 'agent' } });
  expect(res.statusCode).toBe(400);
});

it('refuses to deactivate or demote the last active admin', async () => {
  const app = buildApp();
  const a = await createStaff({ email: 'a@vista.id', password: 'correct-horse-1', displayName: 'A', role: 'admin' });
  const off = await app.inject({ method: 'PATCH', url: `/api/v1/staff/${a.id}`, headers: auth, payload: { isActive: false } });
  expect(off.statusCode).toBe(409);
  expect(off.json().error).toBe('LAST_ADMIN');
  const demote = await app.inject({ method: 'PATCH', url: `/api/v1/staff/${a.id}`, headers: auth, payload: { role: 'sales' } });
  expect(demote.statusCode).toBe(409);
  await createStaff({ email: 'b@vista.id', password: 'correct-horse-1', displayName: 'B', role: 'admin' });
  const ok = await app.inject({ method: 'PATCH', url: `/api/v1/staff/${a.id}`, headers: auth, payload: { isActive: false } });
  expect(ok.statusCode).toBe(200);
  expect(ok.json().data.isActive).toBe(false);
});

it('PATCH answers 404 for an unknown staff id', async () => {
  const res = await buildApp().inject({ method: 'PATCH', url: '/api/v1/staff/00000000-0000-0000-0000-000000000000', headers: auth, payload: { isActive: false } });
  expect(res.statusCode).toBe(404);
});
