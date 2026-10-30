import type Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_RULES } from './prompts/system.js';

/**
 * Three system blocks. The first (rules + FLOW MONI) changes only when staff save a new prompt
 * version, so it carries the cache breakpoint; the per-turn facts and lead state follow it.
 */
export function buildSystemBlocks(input: {
  flowText: string;
  persona: string;
  projectFacts: string;
  leadState: string;
  nowWib: string;
}): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: 'text', text: `${SYSTEM_RULES}\n\n# FLOW MONI\n${input.flowText}`, cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: `PERSONA: ${input.persona}\nWAKTU: ${input.nowWib}\n\n${input.projectFacts}` },
    { type: 'text', text: input.leadState },
  ];
}

/** "Jumat, 30 Oktober 2026 10.00 WIB". */
export function nowWibLabel(now: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value])
  );
  return `${p.weekday}, ${p.day} ${p.month} ${p.year} ${p.hour}.${p.minute} WIB`;
}
