import type Anthropic from '@anthropic-ai/sdk';
import { effortFor, type AnthropicLike } from './claude.js';
import { runTool, type QueuedMaterial, type SimulationRecord, type TurnContext } from './executor.js';
import { checkReply } from './replyChecks.js';
import { MONI_TOOLS, TOOL_INPUTS } from './tools.js';
import { toWhatsAppMarkup } from '../chakra/client.js';

export type TraceEntry = { tool: string; input: unknown; isError: boolean; output: string };

export type AgentTurnResult =
  | {
      kind: 'reply';
      message: string;
      materials: QueuedMaterial[];
      materialsPosition: 'before' | 'after';
      handoffReason: string | null;
      simulations: SimulationRecord[];
      trace: TraceEntry[];
    }
  | { kind: 'no_reply'; handoffReason: string | null; trace: TraceEntry[] }
  | {
      kind: 'failed';
      reason: 'AI_NOT_CONFIGURED' | 'NO_RESPOND_TOOL' | 'REPLY_CHECK' | 'REFUSAL' | 'API_ERROR' | 'TOO_MANY_STEPS';
      detail: string;
      trace: TraceEntry[];
    };

const MAX_CALLS = 8;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const FAILSAFE =
  '[Instruksi sistem: panggil respond_to_customer sekarang dengan balasan final (atau no_reply true). Jangan menulis teks bebas.]';

/**
 * One customer turn: a manual tool loop whose only exit is respond_to_customer. A reply that
 * fails the deterministic checks is sent back once for a rewrite; a second failure fails the turn
 * (the router then hands the chat to staff rather than send anything unchecked).
 */
export async function runAgentTurn(
  input: {
    system: Anthropic.Beta.BetaTextBlockParam[];
    history: Anthropic.Beta.BetaMessageParam[];
    latest: string;
    ctx: TurnContext;
    settings: { model: string; effort: 'low' | 'medium' | 'high' };
  },
  client: AnthropicLike | null
): Promise<AgentTurnResult> {
  const trace: TraceEntry[] = [];
  if (!client) return { kind: 'failed', reason: 'AI_NOT_CONFIGURED', detail: 'neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set', trace };
  const { ctx } = input;
  const messages: Anthropic.Beta.BetaMessageParam[] = [...input.history, { role: 'user', content: input.latest }];
  let failsafeUsed = false;
  let rewriteUsed = false;

  for (let call = 0; call < MAX_CALLS; call++) {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create({
        model: input.settings.model,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: effortFor(input.settings.model, input.settings.effort),
        system: input.system,
        tools: MONI_TOOLS,
        messages,
      });
    } catch (err) {
      return { kind: 'failed', reason: 'API_ERROR', detail: err instanceof Error ? err.message : String(err), trace };
    }
    if (res.stop_reason === 'refusal') {
      const category = (res as { stop_details?: { category?: string | null } | null }).stop_details?.category ?? 'unknown';
      return { kind: 'failed', reason: 'REFUSAL', detail: String(category), trace };
    }
    if (res.stop_reason === 'max_tokens') {
      // The reply was cut off; the loop carries on (the failsafe or a retry asks again).
      console.warn('[agent] model response hit max_tokens');
      trace.push({ tool: '(model)', input: null, isError: true, output: 'max_tokens' });
    }
    messages.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] });

    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (uses.length === 0) {
      if (failsafeUsed) return { kind: 'failed', reason: 'NO_RESPOND_TOOL', detail: 'model answered without respond_to_customer twice', trace };
      failsafeUsed = true;
      messages.push({ role: 'user', content: FAILSAFE });
      continue;
    }

    // Every other tool in this response runs first: a send_materials beside the reply must queue.
    const results = new Map<string, { content: string; isError: boolean }>();
    for (const use of uses) {
      if (use.name === 'respond_to_customer') continue;
      const r = await runTool(use.name, use.input, ctx);
      trace.push({ tool: use.name, input: use.input, isError: r.isError, output: r.content });
      results.set(use.id, r);
    }

    const respond = uses.find((u) => u.name === 'respond_to_customer');
    if (respond) {
      const parsed = TOOL_INPUTS.respond_to_customer.safeParse(respond.input);
      let rejection: string;
      if (!parsed.success) {
        rejection = 'Input respond_to_customer tidak valid. Isi message (teks) dan no_reply (boolean).';
      } else if (parsed.data.no_reply && !parsed.data.message.trim()) {
        trace.push({ tool: 'respond_to_customer', input: respond.input, isError: false, output: 'no_reply' });
        return { kind: 'no_reply', handoffReason: ctx.handoffReason, trace };
      } else {
        const check = checkReply(parsed.data.message, ctx.evidence);
        if (check.ok) {
          trace.push({ tool: 'respond_to_customer', input: respond.input, isError: false, output: 'ok' });
          return {
            kind: 'reply',
            message: toWhatsAppMarkup(parsed.data.message),
            materials: ctx.queuedMaterials,
            materialsPosition: parsed.data.materials_position,
            handoffReason: ctx.handoffReason,
            simulations: ctx.simulations,
            trace,
          };
        }
        rejection = `Balasan ditolak: ${check.problems.join(' ')} Panggil respond_to_customer lagi dengan balasan yang diperbaiki.`;
        if (rewriteUsed) {
          trace.push({ tool: 'respond_to_customer', input: respond.input, isError: true, output: rejection });
          return { kind: 'failed', reason: 'REPLY_CHECK', detail: check.problems.join(' '), trace };
        }
        rewriteUsed = true;
      }
      trace.push({ tool: 'respond_to_customer', input: respond.input, isError: true, output: rejection });
      results.set(respond.id, { content: rejection, isError: true });
    }

    messages.push({
      role: 'user',
      content: uses.map((u) => {
        const r = results.get(u.id)!;
        return { type: 'tool_result' as const, tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
      }),
    });
  }
  return { kind: 'failed', reason: 'TOO_MANY_STEPS', detail: `no reply after ${MAX_CALLS} model calls`, trace };
}
