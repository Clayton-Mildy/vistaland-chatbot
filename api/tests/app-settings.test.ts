import { it, expect, beforeEach } from 'vitest';
import { truncate } from './helpers/db.js';
import { getAppSettings, updateAppSettings } from '../src/settings/appSettings.js';

beforeEach(() => truncate('app_settings'));

it('returns defaults when nothing is stored and merges a patch', async () => {
  expect(await getAppSettings()).toEqual({ aiEnabled: true, personaGroupName: 'tim Vista Land', takeoverHours: 24 });
  await updateAppSettings({ takeoverHours: 6 });
  expect(await getAppSettings()).toEqual({ aiEnabled: true, personaGroupName: 'tim Vista Land', takeoverHours: 6 });
});
