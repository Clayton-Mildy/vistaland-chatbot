import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { createStaff } from '../src/repositories/staff.js';
import { currentPrompt } from '../src/repositories/promptVersions.js';
import { FLOW_MONI } from '../src/agent/prompts/flowMoni.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };

beforeEach(() => truncate('app_settings', 'prompt_versions', 'staff_users'));

it('reads defaults and validates updates', async () => {
  const app = buildApp();
  expect((await app.inject({ method: 'GET', url: '/api/v1/settings', headers: auth })).json().data).toEqual({
    aiEnabled: true,
    personaGroupName: 'tim Vista Land',
    takeoverHours: 24,
    chakraPhoneNumberId: '',
    salesAlertTemplate: { name: '', language: 'id' },
    reassignNoticeTemplate: { name: '', language: 'id' },
  });
  const ok = await app.inject({ method: 'PUT', url: '/api/v1/settings', headers: auth, payload: { aiEnabled: false, takeoverHours: 12 } });
  expect(ok.json().data).toMatchObject({ aiEnabled: false, takeoverHours: 12 });
  for (const payload of [{ takeoverHours: 0 }, { takeoverHours: 169 }, { personaGroupName: 'ab' },
    { salesAlertTemplate: { name: 'Bad Name', language: 'id' } },
    { reassignNoticeTemplate: { name: 'ok_name', language: 'indonesia' } },
    { chakraPhoneNumberId: '12ab' },
    { chakraPhoneNumberId: '1'.repeat(31) },
  ]) {
    expect((await app.inject({ method: 'PUT', url: '/api/v1/settings', headers: auth, payload })).statusCode).toBe(400);
  }
});

it('saves the outbound settings', async () => {
  const app = buildApp();
  const payload = { chakraPhoneNumberId: '1234567890', salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' }, reassignNoticeTemplate: { name: '', language: 'en_US' } };
  const res = await app.inject({ method: 'PUT', url: '/api/v1/settings', headers: auth, payload });
  expect(res.statusCode).toBe(200);
  expect(res.json().data).toMatchObject(payload);
});

it('a new prompt version becomes the one Moni uses', async () => {
  const app = buildApp();
  const staff = await createStaff({ email: 'p@vista.id', password: 'correct-horse-1', displayName: 'P', role: 'admin' });
  expect((await currentPrompt()).text).toBe(FLOW_MONI);
  const text = Array(30).fill('FLOW BARU').join(' ');
  const res = await app.inject({ method: 'POST', url: '/api/v1/prompt-versions', headers: { ...auth, 'x-staff-id': staff.id }, payload: { text } });
  expect(res.statusCode).toBe(201);
  expect((await currentPrompt()).text).toBe(text);
  const list = (await app.inject({ method: 'GET', url: '/api/v1/prompt-versions', headers: auth })).json().data;
  expect(list[0]).toMatchObject({ text, createdBy: staff.id });
  expect((await app.inject({ method: 'POST', url: '/api/v1/prompt-versions', headers: auth, payload: { text: 'pendek' } })).statusCode).toBe(400);
});
