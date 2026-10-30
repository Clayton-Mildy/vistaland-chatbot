import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.js';

/** The slice of the SDK client the agent uses, so tests can script it. */
export type AnthropicLike = {
  beta: {
    messages: {
      create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
    };
  };
};

/** Null without an API key: every turn then fails as AI_NOT_CONFIGURED and staff take over. */
export function createAnthropic(): AnthropicLike | null {
  const key = getConfig().ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key, timeout: 120_000, maxRetries: 2 }) as unknown as AnthropicLike;
}
