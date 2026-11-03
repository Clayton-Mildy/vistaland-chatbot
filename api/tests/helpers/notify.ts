import type { Notifier, PushNote } from '../../src/notify/push.js';

/** A notifier that records what it was asked to send instead of pushing. */
export function recordingNotifier(): Notifier & { sent: { staffUserIds: string[]; note: PushNote }[] } {
  const sent: { staffUserIds: string[]; note: PushNote }[] = [];
  return {
    sent,
    async send(staffUserIds, note) {
      sent.push({ staffUserIds, note });
    },
  };
}
