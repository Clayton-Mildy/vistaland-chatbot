import { describe, it, expect } from 'vitest';
import { claudeAuth, createAnthropic, effortFor, OAUTH_BETA } from '../src/agent/claude.js';
import { parseConfig } from '../src/config.js';

type Seen = { url: string; headers: Headers; body: Record<string, unknown> };

/** A fetch that records the request and answers with a minimal message. */
function recordingFetch(seen: Seen[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const msg = {
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const params = {
  model: 'claude-opus-5-5',
  max_tokens: 16,
  betas: ['server-side-fallback-2026-07-01'],
  messages: [{ role: 'user' as const, content: 'Halo' }],
};

describe('claudeAuth', () => {
  it('prefers the API key, then the OAuth token, else none', () => {
    expect(claudeAuth({ ANTHROPIC_API_KEY: 'sk-ant-api', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat' })).toBe('api_key');
    expect(claudeAuth({ ANTHROPIC_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat' })).toBe('oauth');
    expect(claudeAuth({ ANTHROPIC_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: '' })).toBe('none');
  });

  it('config trims both credentials, so a stray space or CR does not count as a credential', () => {
    const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', API_SECRET_KEY: 'x'.repeat(32) };
    const c = parseConfig({ ...base, ANTHROPIC_API_KEY: '  ', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat\r' });
    expect(c.ANTHROPIC_API_KEY).toBe('');
    expect(c.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat');
    expect(claudeAuth(c)).toBe('oauth');
  });
});

describe('createAnthropic', () => {
  it('returns null without a credential', () => {
    expect(createAnthropic({ ANTHROPIC_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: '' })).toBeNull();
  });

  it('uses the API key when both are set, without the OAuth beta', async () => {
    const seen: Seen[] = [];
    const client = createAnthropic({ ANTHROPIC_API_KEY: 'sk-ant-api-key', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-token' }, { fetch: recordingFetch(seen) })!;
    await client.beta.messages.create(params);
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer sk-ant-api-key');
    expect(seen[0]!.headers.get('anthropic-beta')).not.toContain(OAUTH_BETA);
  });

  it('uses the OAuth token without an API key and adds the OAuth beta to the request betas', async () => {
    const seen: Seen[] = [];
    const client = createAnthropic({ ANTHROPIC_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-token' }, { fetch: recordingFetch(seen) })!;
    const res = await client.beta.messages.create(params);
    expect(res.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer sk-ant-oat-token');
    expect(seen[0]!.headers.get('x-api-key')).toBeNull();
    const betas = seen[0]!.headers.get('anthropic-beta')!.split(',');
    expect(betas).toEqual(expect.arrayContaining([OAUTH_BETA, 'server-side-fallback-2026-07-01']));
    expect(seen[0]!.body['betas']).toBeUndefined();
  });

  it('adds the OAuth beta when the request has no betas, and never twice', async () => {
    const seen: Seen[] = [];
    const client = createAnthropic({ ANTHROPIC_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-token' }, { fetch: recordingFetch(seen) })!;
    await client.beta.messages.create({ ...params, betas: undefined });
    await client.beta.messages.create({ ...params, betas: [OAUTH_BETA] });
    expect(seen[0]!.headers.get('anthropic-beta')!.split(',')).toContain(OAUTH_BETA);
    expect(seen[1]!.headers.get('anthropic-beta')!.split(',').filter((b) => b === OAUTH_BETA)).toHaveLength(1);
  });
});

describe('effortFor', () => {
  it('sends effort to current models and leaves it out for models that reject it', () => {
    expect(effortFor('claude-opus-5-5', 'medium')).toEqual({ effort: 'medium' });
    expect(effortFor('claude-haiku-5-5', 'low')).toEqual({ effort: 'low' });
    expect(effortFor('claude-haiku-4-5-20251001', 'medium')).toEqual({});
    expect(effortFor('claude-haiku-4-5', 'low')).toEqual({});
  });
});
