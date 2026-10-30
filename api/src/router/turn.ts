import type Anthropic from '@anthropic-ai/sdk';
import type { VlesClient } from '../vles/client.js';
import type { AnthropicLike } from '../agent/claude.js';
import { runAgentTurn, type AgentTurnResult } from '../agent/loop.js';
import { newTurnContext } from '../agent/executor.js';
import { buildSystemBlocks, nowWibLabel } from '../agent/prompt.js';
import { collectAmounts } from '../agent/rupiah.js';
import { getAppSettings } from '../settings/appSettings.js';
import { currentPrompt } from '../repositories/promptVersions.js';
import { getProject } from '../repositories/projects.js';
import { buildProjectFacts } from '../knowledge/facts.js';
import { todayWib } from '../knowledge/format.js';
import { buildLeadState } from '../leads/state.js';
import {
  customerMessagesSince,
  getContact,
  getConversation,
  getLeadByContact,
  insertOutbound,
  isUnderTakeover,
  lastOutboundAt,
  listEvents,
  recentMessages,
  recordEvent,
  setTakeover,
  updateConversation,
  type Message,
} from '../leads/repository.js';
import { mediaKindFor, type Transport } from './transport.js';

export type TurnDeps = {
  transport: Transport;
  anthropic: AnthropicLike | null;
  vles: VlesClient | null;
  now: () => Date;
  settings: { model: string; effort: 'low' | 'medium' | 'high' };
  // Looks for replies staff typed in ChakraHQ's own inbox; true means a human is talking.
  staffSync?: (conversationId: string) => Promise<boolean>;
};

export type TurnOutcome = { kind: 'replied' | 'no_reply' | 'skipped' | 'failed'; sent: number; result?: AgentTurnResult };

const HISTORY = 20;
const EPOCH = new Date(0);

/** How a stored message reads to the model. */
function asText(m: Message): string {
  if (m.sender === 'staff') return `[Tim sales menulis: ${m.body}]`;
  if (m.direction === 'out' && m.kind !== 'text') return `[materi terkirim: ${m.body}]`;
  switch (m.kind) {
    case 'image':
      return m.body ? `[gambar: ${m.body}]` : '[gambar]';
    case 'document':
      return m.body ? `[dokumen: ${m.body}]` : '[dokumen]';
    case 'audio':
    case 'video':
      return '[pesan suara/video]';
    case 'text':
      return m.body;
    default:
      return m.body || '[pesan]';
  }
}

/** Earlier messages as alternating turns, starting with the customer. */
function toHistory(messages: Message[]): Anthropic.Beta.BetaMessageParam[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.sender === 'system') continue;
    const role = m.direction === 'in' ? 'user' : 'assistant';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${asText(m)}`;
    else out.push({ role, content: asText(m) });
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

async function takeoverHours(): Promise<number> {
  return (await getAppSettings()).takeoverHours;
}

/** Runs one Moni turn for whatever the customer wrote since Moni last spoke. */
export async function runTurn(conversationId: string, deps: TurnDeps): Promise<TurnOutcome> {
  const conv = await getConversation(conversationId);
  if (!conv) return { kind: 'skipped', sent: 0 };
  const app = await getAppSettings();
  if (!app.aiEnabled || !conv.aiEnabled || isUnderTakeover(conv, deps.now())) return { kind: 'skipped', sent: 0 };
  const contact = await getContact(conv.contactId);
  const lead = await getLeadByContact(conv.contactId);
  if (!contact || !lead) return { kind: 'skipped', sent: 0 };

  const since = (await lastOutboundAt(conversationId)) ?? EPOCH;
  let superseded = false;
  let result: AgentTurnResult;
  for (;;) {
    const batch = await customerMessagesSince(conversationId, since);
    if (batch.length === 0) return { kind: 'skipped', sent: 0 };
    const batchIds = new Set(batch.map((m) => m.id));
    const earlier = (await recentMessages(conversationId, HISTORY + batch.length)).filter((m) => !batchIds.has(m.id)).slice(-HISTORY);

    const freshLead = (await getLeadByContact(conv.contactId))!;
    const project = freshLead.currentProjectId ? await getProject(freshLead.currentProjectId) : null;
    const today = todayWib(deps.now());
    const facts = await buildProjectFacts(project?.id ?? null, today);
    const leadState = buildLeadState(freshLead, await listEvents(freshLead.id));
    const prompt = await currentPrompt();
    const ctx = newTurnContext({
      leadId: freshLead.id,
      contactId: contact.id,
      projectId: project?.id ?? null,
      vles: deps.vles,
      today,
      subsidiNotes: project?.subsidiNotes ?? null,
    });
    ctx.evidence.knownAmounts.push(...collectAmounts(`${facts}\n${leadState}`));

    result = await runAgentTurn(
      {
        system: buildSystemBlocks({
          flowText: prompt.text,
          persona: project?.personaTeamName ?? app.personaGroupName,
          projectFacts: facts,
          leadState,
          nowWib: nowWibLabel(deps.now()),
        }),
        history: toHistory(earlier),
        latest: batch.map(asText).join('\n'),
        ctx,
        settings: deps.settings,
      },
      deps.anthropic
    );

    // The customer wrote again while Moni was thinking: answer everything together, once.
    const after = await customerMessagesSince(conversationId, since);
    if (!superseded && after.length > batch.length && result.kind !== 'failed') {
      superseded = true;
      continue;
    }
    break;
  }

  const now = deps.now();
  if (result.kind === 'failed') {
    await setTakeover(conversationId, new Date(now.getTime() + (await takeoverHours()) * 3_600_000), 'system', `Moni gagal menjawab (${result.reason}): ${result.detail}`);
    return { kind: 'failed', sent: 0, result };
  }
  if (result.kind === 'no_reply') {
    if (result.handoffReason) await setTakeover(conversationId, new Date(now.getTime() + (await takeoverHours()) * 3_600_000), 'moni', result.handoffReason);
    return { kind: 'no_reply', sent: 0, result };
  }

  let sent = 0;
  let textSent = false;
  const to = contact.waPhone;

  const sendText = async () => {
    try {
      const r = await deps.transport.sendText(to, result.kind === 'reply' ? result.message : '');
      await insertOutbound(conversationId, { sender: 'moni', kind: 'text', body: result.kind === 'reply' ? result.message : '', waMessageId: r.waMessageId, status: 'sent' });
      sent++;
      textSent = true;
    } catch (err) {
      await insertOutbound(conversationId, { sender: 'moni', kind: 'text', body: result.kind === 'reply' ? result.message : '', waMessageId: null, status: 'failed' });
      console.error(`[router] text send failed for ${conversationId}:`, err instanceof Error ? err.message : err);
    }
  };
  const sendMaterials = async () => {
    if (result.kind !== 'reply') return;
    for (const m of result.materials) {
      const kind = mediaKindFor(m.mime);
      try {
        const r = await deps.transport.sendMedia(to, { kind, link: m.url, filename: m.filename });
        await insertOutbound(conversationId, { sender: 'moni', kind, body: m.filename, mediaUrl: m.url, waMessageId: r.waMessageId, status: 'sent' });
        await recordEvent(lead.id, 'material_sent', { materialId: m.materialId, kind: m.kind, filename: m.filename }, 'moni');
        sent++;
      } catch (err) {
        await insertOutbound(conversationId, { sender: 'moni', kind, body: m.filename, mediaUrl: m.url, waMessageId: null, status: 'failed' });
        await recordEvent(lead.id, 'material_failed', { materialId: m.materialId, error: err instanceof Error ? err.message : String(err) }, 'moni');
      }
    }
  };

  if (result.materialsPosition === 'before') {
    await sendMaterials();
    await sendText();
  } else {
    await sendText();
    if (textSent) await sendMaterials();
  }

  if (textSent) {
    for (const s of result.simulations) await recordEvent(lead.id, 'simulation_sent', s, 'moni');
  }
  if (sent > 0) await updateConversation(conversationId, { lastMoniMsgAt: now });

  const hours = await takeoverHours();
  if (!textSent) {
    // The customer got no answer: put the chat in front of staff.
    await setTakeover(conversationId, new Date(now.getTime() + hours * 3_600_000), 'system', 'Balasan Moni gagal terkirim');
    return { kind: 'failed', sent, result };
  }
  if (result.handoffReason) await setTakeover(conversationId, new Date(now.getTime() + hours * 3_600_000), 'moni', result.handoffReason);
  return { kind: 'replied', sent, result };
}
