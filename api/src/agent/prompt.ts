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
  // calendarWib(now, 14): the next two weeks' dates, so Moni never computes a weekday herself.
  calendar: string;
}): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: 'text', text: `${SYSTEM_RULES}\n\n# FLOW MONI\n${input.flowText}`, cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: `PERSONA: ${input.persona}\nWAKTU: ${input.nowWib}\n${input.calendar}\n\n${input.projectFacts}` },
    { type: 'text', text: input.leadState },
  ];
}

export { wibLabel as nowWibLabel, calendarWib } from '../scheduling/time.js';
