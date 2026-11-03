import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', API_SECRET_KEY: 'x'.repeat(32) };

describe('parseConfig', () => {
  it('applies defaults', () => {
    const c = parseConfig(base);
    expect(c.PORT).toBe(50060);
    expect(c.VLES_BASE_URL).toBe('https://vles.vistalandapp.com/api/v1/integration');
    expect(c.VLES_SYNC_INTERVAL_MS).toBe(900000);
    expect(c.VLES_MAX_REQ_PER_MIN).toBe(100);
    expect(c.VLES_API_KEY).toBe('');
  });

  it('defaults the outbound, summary and push settings', () => {
    const c = parseConfig(base);
    expect(c).toMatchObject({
      OUTBOUND_POLL_MS: 60000,
      SUMMARY_REFRESH_MS: 600000,
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: 'mailto:admin@localhost',
      DASHBOARD_PUBLIC_URL: 'http://localhost:40060',
    });
    expect(parseConfig({ ...base, OUTBOUND_POLL_MS: '0' }).OUTBOUND_POLL_MS).toBe(0);
  });

  it('rejects a missing DATABASE_URL and a short API_SECRET_KEY in one error', () => {
    expect(() => parseConfig({ API_SECRET_KEY: 'short' })).toThrow(/DATABASE_URL[\s\S]*API_SECRET_KEY/);
  });

  it('rejects VLES_MAX_REQ_PER_MIN above the VLES limit', () => {
    expect(() => parseConfig({ ...base, VLES_MAX_REQ_PER_MIN: '121' })).toThrow(/VLES_MAX_REQ_PER_MIN/);
  });
});
