import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { getAppSettings, updateAppSettings } from '../src/settings/appSettings.js';

const DEFAULTS = {
  aiEnabled: true,
  personaGroupName: 'tim Vista Land',
  takeoverHours: 24,
  chakraPhoneNumberId: '',
  salesAlertTemplate: { name: '', language: 'id' },
  reassignNoticeTemplate: { name: '', language: 'id' },
};

beforeEach(() => truncate('app_settings'));

it('returns defaults when nothing is stored and merges a patch', async () => {
  expect(await getAppSettings()).toEqual(DEFAULTS);
  await updateAppSettings({ takeoverHours: 6 });
  expect(await getAppSettings()).toEqual({ ...DEFAULTS, takeoverHours: 6 });
});

it('round-trips the outbound settings', async () => {
  await updateAppSettings({
    chakraPhoneNumberId: '1234567890',
    salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' },
    reassignNoticeTemplate: { name: 'reassign_notice_v1', language: 'en_US' },
  });
  expect(await getAppSettings()).toEqual({
    ...DEFAULTS,
    chakraPhoneNumberId: '1234567890',
    salesAlertTemplate: { name: 'sales_alert_v1', language: 'id' },
    reassignNoticeTemplate: { name: 'reassign_notice_v1', language: 'en_US' },
  });
});
