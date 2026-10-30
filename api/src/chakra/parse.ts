// ChakraHQ forwards Meta's WhatsApp Cloud API webhook format unchanged:
// entry[].changes[].value.{metadata, contacts[], messages[], statuses[]}.

export type InboundReferral = {
  sourceUrl: string | null;
  sourceType: string | null;
  headline: string | null;
  body: string | null;
};

export type InboundMessage = {
  waMessageId: string;
  from: string;
  profileName: string | null;
  // The business number written to; replies must go out from it.
  phoneNumberId: string;
  sentAt: Date;
  kind: 'text' | 'image' | 'document' | 'audio' | 'video' | 'other';
  text: string;
  mediaId: string | null;
  // Click-to-WhatsApp ad data. Meta sends it; whether ChakraHQ passes it on is unconfirmed.
  referral: InboundReferral | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const SKIPPED = new Set(['reaction', 'edit', 'revoke', 'unsupported', 'system']);
const KINDS = new Set(['text', 'image', 'document', 'audio', 'video']);

export function parseWebhook(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of arr(obj(body)?.['entry'])) {
    for (const change of arr(obj(entry)?.['changes'])) {
      const value = obj(obj(change)?.['value']);
      if (!value) continue;
      const phoneNumberId = str(obj(value['metadata'])?.['phone_number_id']) ?? '';
      const names = new Map<string, string>();
      for (const c of arr(value['contacts'])) {
        const id = str(obj(c)?.['wa_id']);
        const name = str(obj(obj(c)?.['profile'])?.['name']);
        if (id && name) names.set(id, name);
      }
      // value.statuses (delivery receipts) are ignored on purpose.
      for (const raw of arr(value['messages'])) {
        const m = obj(raw);
        const id = str(m?.['id']);
        const from = str(m?.['from']);
        const type = str(m?.['type']) ?? 'other';
        if (!m || !id || !from || SKIPPED.has(type)) continue;
        const media = obj(m[type]);
        const ref = obj(m['referral']);
        out.push({
          waMessageId: id,
          from,
          profileName: names.get(from) ?? null,
          phoneNumberId,
          sentAt: new Date(Number(str(m['timestamp']) ?? 0) * 1000 || Date.now()),
          kind: (KINDS.has(type) ? type : 'other') as InboundMessage['kind'],
          text: str(obj(m['text'])?.['body']) ?? str(media?.['caption']) ?? '',
          mediaId: type === 'text' ? null : str(media?.['id']),
          referral: ref
            ? {
                sourceUrl: str(ref['source_url']),
                sourceType: str(ref['source_type']),
                headline: str(ref['headline']),
                body: str(ref['body']),
              }
            : null,
        });
      }
    }
  }
  return out;
}
