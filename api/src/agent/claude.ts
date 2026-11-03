import Anthropic from '@anthropic-ai/sdk';
import { getConfig, type Config } from '../config.js';

/** The slice of the SDK client the agent uses, so tests can script it. */
export type AnthropicLike = {
  beta: {
    messages: {
      create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
    };
  };
};

// Models from before the effort setting reject the request when it is sent (Haiku 4.5, for one).
const NO_EFFORT = /^claude-(3-|haiku-4-5|sonnet-4-5|sonnet-4-2|opus-4-1|opus-4-2)/;

/** The output_config effort field, left out for models that refuse it. */
export function effortFor(model: string, effort: 'low' | 'medium' | 'high'): { effort?: 'low' | 'medium' | 'high' } {
  return NO_EFFORT.test(model) ? {} : { effort };
}

export type ClaudeAuth = 'api_key' | 'oauth' | 'none';

/** Claude accepts a Claude account's OAuth token only with this beta flag on the request. */
export const OAUTH_BETA = 'oauth-2025-04-20';

/** An API key always wins; the Claude account's OAuth token is used only when no key is set. */
export function claudeAuth(config: Pick<Config, 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN'>): ClaudeAuth {
  if (config.ANTHROPIC_API_KEY) return 'api_key';
  if (config.CLAUDE_CODE_OAUTH_TOKEN) return 'oauth';
  return 'none';
}

/**
 * Null without a credential: every turn then fails as AI_NOT_CONFIGURED and staff take over.
 * Credentials come only from the app's config, never from the SDK's own environment lookup.
 */
export function createAnthropic(
  config: Pick<Config, 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN'> = getConfig(),
  opts: { fetch?: typeof fetch } = {}
): AnthropicLike | null {
  const common = { timeout: 120_000, maxRetries: 2, ...(opts.fetch ? { fetch: opts.fetch } : {}) };
  switch (claudeAuth(config)) {
    case 'api_key':
      return new Anthropic({ ...common, apiKey: config.ANTHROPIC_API_KEY }) as unknown as AnthropicLike;
    case 'oauth': {
      const client = new Anthropic({ ...common, authToken: config.CLAUDE_CODE_OAUTH_TOKEN });
      // The request's betas set the anthropic-beta header, so the OAuth flag joins them on every call.
      return {
        beta: {
          messages: {
            create: (params) =>
              client.beta.messages.create({ ...params, betas: [OAUTH_BETA, ...(params.betas ?? []).filter((b) => b !== OAUTH_BETA)] }),
          },
        },
      };
    }
    case 'none':
      return null;
  }
}
