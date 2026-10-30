import type { ChakraClient, ChakraSend } from '../chakra/client.js';

/** Where a turn's messages go: ChakraHQ in production, a recorder for the test chat. */
export type Transport = {
  sendText(to: string, body: string): Promise<ChakraSend>;
  sendMedia(to: string, m: { kind: 'image' | 'video' | 'document'; link: string; filename?: string }): Promise<ChakraSend>;
};

export function chakraTransport(client: ChakraClient, phoneNumberId: string): Transport {
  return {
    sendText: (to, body) => client.sendText(phoneNumberId, to, body),
    sendMedia: (to, m) => client.sendMedia(phoneNumberId, to, m),
  };
}

export type RecordedSend = { kind: string; body?: string; link?: string };

export function recordingTransport(): Transport & { sent: RecordedSend[] } {
  const sent: RecordedSend[] = [];
  return {
    sent,
    async sendText(_to, body) {
      sent.push({ kind: 'text', body });
      return { waMessageId: null };
    },
    async sendMedia(_to, m) {
      sent.push({ kind: m.kind, link: m.link });
      return { waMessageId: null };
    },
  };
}

export function mediaKindFor(mime: string): 'image' | 'video' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}
