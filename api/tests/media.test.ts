import { it, expect, beforeEach } from 'vitest';
import { readdirSync, rmSync, mkdirSync } from 'fs';
import { buildApp } from '../src/app.js';
import { multipart, PNG_1PX } from './helpers/http.js';

const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };
const MEDIA_DIR = process.env['MEDIA_DIR']!;

beforeEach(() => {
  rmSync(MEDIA_DIR, { recursive: true, force: true });
  mkdirSync(MEDIA_DIR, { recursive: true });
});

it('stores a png and serves it publicly', async () => {
  const app = buildApp();
  const { payload, headers } = multipart('file', 'flyer.png', 'image/png', PNG_1PX);
  const res = await app.inject({ method: 'POST', url: '/api/v1/media', headers: { ...auth, ...headers }, payload });
  expect(res.statusCode).toBe(201);
  const { url, mime, filename, size } = res.json().data;
  expect(url).toMatch(/^http:\/\/localhost:50060\/media\/[0-9a-f-]{36}\.png$/);
  expect({ mime, filename, size }).toEqual({ mime: 'image/png', filename: 'flyer.png', size: PNG_1PX.length });
  const served = await app.inject({ method: 'GET', url: new URL(url).pathname });
  expect(served.statusCode).toBe(200);
  expect(served.headers['content-type']).toBe('image/png');
});

it('requires the API secret to upload', async () => {
  const { payload, headers } = multipart('file', 'flyer.png', 'image/png', PNG_1PX);
  expect((await buildApp().inject({ method: 'POST', url: '/api/v1/media', headers, payload })).statusCode).toBe(401);
});

it('rejects webp and files over 16 MB', async () => {
  const app = buildApp();
  const webp = multipart('file', 'a.webp', 'image/webp', Buffer.from('RIFF0000WEBP'));
  const r1 = await app.inject({ method: 'POST', url: '/api/v1/media', headers: { ...auth, ...webp.headers }, payload: webp.payload });
  expect(r1.statusCode).toBe(400);
  expect(r1.json().error).toBe('UNSUPPORTED_TYPE');
  const big = multipart('file', 'big.mp4', 'video/mp4', Buffer.alloc(16 * 1024 * 1024 + 1));
  const r2 = await app.inject({ method: 'POST', url: '/api/v1/media', headers: { ...auth, ...big.headers }, payload: big.payload });
  expect(r2.statusCode).toBe(400);
  expect(r2.json().error).toBe('TOO_LARGE');
  expect(readdirSync(MEDIA_DIR)).toEqual([]);
});
