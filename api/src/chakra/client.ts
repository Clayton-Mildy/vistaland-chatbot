// Sends WhatsApp messages through ChakraHQ's pass-through of Meta's Cloud API. Media goes by
// public link only: ChakraHQ does not support Meta's media upload endpoint.

export type ChakraSend = { waMessageId: string | null };

export type ChakraMedia = { kind: 'image' | 'video' | 'document'; link: string; caption?: string; filename?: string };

/** A message in ChakraHQ's chat history. externalId is the wamid; timestamps are epoch ms. */
export type ChakraChatMessage = {
  id: string;
  externalId?: string | null;
  direction?: string | null;
  text?: string | null;
  dataType?: string | null;
  timestamp?: number | null;
  createdAt?: number | null;
};

export type ChakraClient = {
  sendText(phoneNumberId: string, to: string, body: string): Promise<ChakraSend>;
  sendMedia(phoneNumberId: string, to: string, m: ChakraMedia): Promise<ChakraSend>;
  // Chat history. The webhook never carries replies staff type in ChakraHQ's inbox; these do.
  findChatId(waPhone: string): Promise<string | null>;
  listChatMessages(chatId: string, limit: number): Promise<ChakraChatMessage[]>;
};

export class ChakraError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`ChakraHQ send failed with ${status}${body ? `: ${body.slice(0, 300)}` : ''}`);
    this.name = 'ChakraError';
  }
}

const BACKOFF_MS = [1000, 2000, 4000];

export function createChakraClient(cfg: {
  baseUrl: string;
  pluginId: string;
  apiVersion: string;
  accessToken: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): ChakraClient {
  const doFetch = cfg.fetch ?? fetch;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = cfg.baseUrl.replace(/\/+$/, '');

  async function post(phoneNumberId: string, payload: object): Promise<ChakraSend> {
    const url = `${base}/v1/ext/plugin/whatsapp/${cfg.pluginId}/api/${cfg.apiVersion}/${phoneNumberId}/messages`;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        if (attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt]!);
          continue;
        }
        throw new ChakraError(0, err instanceof Error ? err.message : String(err));
      }
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { _data?: { whatsappMessageId?: string } };
        return { waMessageId: body._data?.whatsappMessageId ?? null };
      }
      if (res.status >= 500 && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]!);
        continue;
      }
      throw new ChakraError(res.status, await res.text().catch(() => ''));
    }
  }

  // /v1/ext/chat sits outside the plugin pass-through prefix: same host and token, different path.
  async function list<T>(path: string, body: object): Promise<T[]> {
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new ChakraError(res.status, await res.text().catch(() => ''));
    return ((await res.json()) as { _data?: T[] })._data ?? [];
  }

  // Chat ids never change, so a found one is kept for the life of the process.
  const chatIds = new Map<string, string>();
  const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

  return {
    async findChatId(waPhone) {
      const wa = digits(waPhone);
      const cached = chatIds.get(wa);
      if (cached) return cached;
      // The customer has just written, so their chat is near the top of the newest-updated list.
      type Chat = { id: string; provider?: string | null; primaryContactHandle?: { value?: string | null } | null };
      const chats = await list<Chat>('/v1/ext/chat', { orderField: 'updatedAt', limit: 100, page: 1 });
      const hit = chats.find((c) => (c.provider ?? 'WHATSAPP') === 'WHATSAPP' && digits(c.primaryContactHandle?.value) === wa);
      if (hit) chatIds.set(wa, hit.id);
      return hit?.id ?? null;
    },
    listChatMessages: (chatId, limit) => list<ChakraChatMessage>(`/v1/ext/chat/${chatId}/message`, { limit, page: 1 }),
    sendText: (phoneNumberId, to, body) =>
      post(phoneNumberId, { messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    sendMedia: (phoneNumberId, to, m) => {
      // Documents carry a filename and no caption.
      const media =
        m.kind === 'document'
          ? { link: m.link, ...(m.filename ? { filename: m.filename } : {}) }
          : { link: m.link, ...(m.caption ? { caption: m.caption } : {}) };
      return post(phoneNumberId, { messaging_product: 'whatsapp', to, type: m.kind, [m.kind]: media });
    },
  };
}

/** Markdown the model may still produce, rewritten into what WhatsApp renders. */
export function toWhatsAppMarkup(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/<\/?parameter[^>]*>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2')
    .trim();
}
