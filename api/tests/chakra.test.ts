import { it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { truncate } from './helpers/db.js';
import { seedProjects } from './helpers/vles.js';
import { json, fakeFetch } from './helpers/vles.js';
import { buildApp } from '../src/app.js';
import { listProjects, type Project } from '../src/repositories/projects.js';
import { upsertChannelTag } from '../src/repositories/channelTags.js';
import { verifyChakraSignature } from '../src/chakra/signature.js';
import { parseWebhook } from '../src/chakra/parse.js';
import { detectProject } from '../src/chakra/detectProject.js';
import { createChakraClient, ChakraError, toWhatsAppMarkup } from '../src/chakra/client.js';

const chakra = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/chakra/${name}`, import.meta.url), 'utf8'));
const SECRET = 'test-webhook-secret';
let zetira: Project;

beforeEach(async () => {
  await truncate('projects', 'channel_tags');
  await seedProjects();
  zetira = (await listProjects()).find((p) => p.slug === 'zetira')!;
});

it('verifies the Chakra signature over the raw bytes', () => {
  const raw = Buffer.from(JSON.stringify(chakra('inbound-text.json')));
  const sig = createHmac('sha256', 's3cret').update(raw).digest('hex');
  expect(verifyChakraSignature(raw, sig, 's3cret')).toBe(true);
  expect(verifyChakraSignature(raw, 'sha256=' + sig, 's3cret')).toBe(false);
  expect(verifyChakraSignature(raw, sig, '')).toBe(false);
  expect(verifyChakraSignature(raw, undefined, 's3cret')).toBe(false);
});

it('parses text, captions, audio, referral; ignores statuses', () => {
  expect(parseWebhook(chakra('inbound-text.json'))[0]).toMatchObject({
    waMessageId: 'wamid.TEXT1',
    from: '6281234567890',
    profileName: 'Sari',
    phoneNumberId: 'PNID-1',
    kind: 'text',
    text: 'Halo [ZTR-REELS] mau tanya promo',
    sentAt: new Date(1793420000 * 1000),
    referral: null,
  });
  expect(parseWebhook(chakra('inbound-image.json'))[0]).toMatchObject({ kind: 'image', text: 'ini rumahnya?', mediaId: 'MEDIA-1' });
  expect(parseWebhook(chakra('inbound-audio.json'))[0]!.kind).toBe('audio');
  expect(parseWebhook(chakra('inbound-status.json'))).toEqual([]);
  expect(parseWebhook(chakra('inbound-referral.json'))[0]!.referral).toEqual({
    sourceUrl: 'https://fb.me/ad1',
    sourceType: 'ad',
    headline: 'Promo Zetira Cibitung',
    body: 'Rumah 2 KT mulai 400 jt',
  });
  expect(parseWebhook({ nonsense: true })).toEqual([]);
});

it('detects the project from a tag, then from the ad referral, else null', async () => {
  await upsertChannelTag({ tag: 'ZTR-REELS', projectId: zetira.id, channel: 'instagram', contentKind: 'reels' });
  expect(await detectProject({ text: 'Halo [ztr-reels]', referral: null })).toMatchObject({ projectId: zetira.id, channel: 'instagram', contentKind: 'reels', ref: 'ZTR-REELS' });
  expect(
    await detectProject({ text: 'halo', referral: { headline: 'Promo Zetira Cibitung', sourceUrl: 'https://fb.me/ad1', sourceType: 'ad', body: null } })
  ).toMatchObject({ projectId: zetira.id, channel: 'other', contentKind: 'general', ref: 'https://fb.me/ad1' });
  expect(await detectProject({ text: 'halo [NOPE]', referral: null })).toBeNull();
  expect(await detectProject({ text: 'halo', referral: null })).toBeNull();
});

const signed = (body: unknown) => {
  const raw = JSON.stringify(body);
  return { payload: raw, headers: { 'content-type': 'application/json', 'x-chakra-signature-256': createHmac('sha256', SECRET).update(raw).digest('hex') } };
};

it('GET /webhook answers OK', async () => {
  const res = await buildApp().inject({ method: 'GET', url: '/webhook' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe('OK');
});

it('POST /webhook acks 200 on a bad signature and processes nothing', async () => {
  const onInbound = vi.fn(async () => {});
  const res = await buildApp({ onInbound }).inject({
    method: 'POST',
    url: '/webhook',
    payload: JSON.stringify(chakra('inbound-text.json')),
    headers: { 'content-type': 'application/json', 'x-chakra-signature-256': 'deadbeef' },
  });
  expect(res.statusCode).toBe(200);
  await new Promise((r) => setTimeout(r, 20));
  expect(onInbound).not.toHaveBeenCalled();
});

it('POST /webhook acks then hands each message to onInbound', async () => {
  const onInbound = vi.fn(async () => {});
  const res = await buildApp({ onInbound }).inject({ method: 'POST', url: '/webhook', ...signed(chakra('inbound-text.json')) });
  expect(res.statusCode).toBe(200);
  await vi.waitFor(() => expect(onInbound).toHaveBeenCalledTimes(1));
  expect(onInbound.mock.calls[0]![0]).toMatchObject({ waMessageId: 'wamid.TEXT1' });
});

const client = (responses: Response[], slept: number[] = []) => {
  const f = fakeFetch(responses);
  return {
    ...f,
    c: createChakraClient({ baseUrl: 'https://api.chakra.test', pluginId: 'PLG', apiVersion: 'v22.0', accessToken: 'tok', fetch: f.fetch, sleep: async (ms) => { slept.push(ms); } }),
  };
};

it('sendText posts the Meta payload and returns the wamid', async () => {
  const { c, calls } = client([json(200, { _data: { whatsappMessageId: 'wamid.A' } })]);
  expect(await c.sendText('PNID-1', '6281234567890', 'Halo Kak')).toEqual({ waMessageId: 'wamid.A' });
  expect(calls[0]!.url).toBe('https://api.chakra.test/v1/ext/plugin/whatsapp/PLG/api/v22.0/PNID-1/messages');
  expect(calls[0]!.headers['authorization']).toBe('Bearer tok');
  expect(JSON.parse(calls[0]!.body!)).toEqual({ messaging_product: 'whatsapp', to: '6281234567890', type: 'text', text: { body: 'Halo Kak' } });
});

it('sendMedia sends a document with filename and no caption; throws ChakraError on 400', async () => {
  const { c, calls } = client([json(200, {}), json(400, { error: 'bad' })]);
  expect(await c.sendMedia('PNID-1', '628', { kind: 'document', link: 'https://x/brosur.pdf', filename: 'brosur.pdf', caption: 'ignored' })).toEqual({ waMessageId: null });
  expect(JSON.parse(calls[0]!.body!).document).toEqual({ link: 'https://x/brosur.pdf', filename: 'brosur.pdf' });
  const err = await c.sendMedia('PNID-1', '628', { kind: 'image', link: 'https://x/a.jpg' }).catch((e) => e);
  expect(err).toBeInstanceOf(ChakraError);
  expect(err.status).toBe(400);
  expect(calls).toHaveLength(2);
});

it('retries a 503 three times, then throws', async () => {
  const slept: number[] = [];
  const { c, calls } = client([json(503, {}), json(503, {}), json(503, {}), json(503, {})], slept);
  const err = await c.sendText('PNID-1', '628', 'x').catch((e) => e);
  expect(err).toBeInstanceOf(ChakraError);
  expect(err.status).toBe(503);
  expect(calls).toHaveLength(4);
  expect(slept).toEqual([1000, 2000, 4000]);
});

it('toWhatsAppMarkup converts bold and links', () => {
  expect(toWhatsAppMarkup('**Promo** [peta](https://m.ps/x)')).toBe('*Promo* peta https://m.ps/x');
  expect(toWhatsAppMarkup('baris 1\\nbaris 2<parameter name="x">')).toBe('baris 1\nbaris 2');
});
