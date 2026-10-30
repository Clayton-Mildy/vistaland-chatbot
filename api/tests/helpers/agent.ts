import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicLike } from '../../src/agent/claude.js';

type Block = { type: 'text'; text: string } | { type: 'tool_use'; name: string; input: unknown };

let seq = 0;

/** A model reply: text and/or tool calls. stop_reason follows from the blocks unless given. */
export function reply(blocks: Block[], stop?: string): Anthropic.Beta.BetaMessage {
  const content = blocks.map((b) => (b.type === 'tool_use' ? { ...b, id: `toolu_${++seq}` } : b));
  return {
    id: `msg_${++seq}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stop ?? (blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

export const tool = (name: string, input: unknown): Block => ({ type: 'tool_use', name, input });
export const text = (t: string): Block => ({ type: 'text', text: t });

/** Replays scripted replies (or a function of the request) and records each request's params. */
export function fakeAnthropic(script: (Anthropic.Beta.BetaMessage | Error | ((p: unknown) => Promise<Anthropic.Beta.BetaMessage>))[]): AnthropicLike & {
  params: Record<string, unknown>[];
} {
  const params: Record<string, unknown>[] = [];
  const queue = [...script];
  return {
    params,
    beta: {
      messages: {
        async create(p) {
          params.push(JSON.parse(JSON.stringify(p)));
          const next = queue.shift();
          if (!next) throw new Error('fakeAnthropic: no scripted reply left');
          if (next instanceof Error) throw next;
          return typeof next === 'function' ? next(p) : next;
        },
      },
    },
  };
}
