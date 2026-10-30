// Customers send a thought as several quick messages. Wait for a pause before answering: quietMs
// after the last message, never more than maxWaitMs after the first, or at once on the
// maxBatch-th. One turn runs per conversation; messages arriving during it start the next wait.

export type Debouncer = { push(conversationId: string): void; pending(conversationId: string): boolean };

export function createDebouncer(cfg: {
  quietMs: number;
  maxWaitMs: number;
  maxBatch: number;
  onFire: (conversationId: string) => Promise<void>;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  now?: () => number;
}): Debouncer {
  const setTimer = cfg.setTimer ?? setTimeout;
  const clearTimer = cfg.clearTimer ?? clearTimeout;
  const now = cfg.now ?? Date.now;
  const waiting = new Map<string, { firstAt: number; count: number; timer: ReturnType<typeof setTimeout> | null }>();
  const running = new Set<string>();
  const arrivedWhileRunning = new Set<string>();

  async function fire(id: string): Promise<void> {
    const st = waiting.get(id);
    if (!st) return;
    if (st.timer) clearTimer(st.timer);
    waiting.delete(id);
    running.add(id);
    try {
      await cfg.onFire(id);
    } catch (err) {
      console.error(`[router] turn for ${id} failed:`, err instanceof Error ? err.message : err);
    } finally {
      running.delete(id);
      if (arrivedWhileRunning.delete(id)) push(id);
    }
  }

  function push(id: string): void {
    if (running.has(id)) {
      arrivedWhileRunning.add(id);
      return;
    }
    const st = waiting.get(id) ?? { firstAt: now(), count: 0, timer: null };
    st.count++;
    if (st.timer) clearTimer(st.timer);
    waiting.set(id, st);
    if (st.count >= cfg.maxBatch) {
      st.timer = null;
      void fire(id);
      return;
    }
    const delay = Math.max(0, Math.min(cfg.quietMs, cfg.maxWaitMs - (now() - st.firstAt)));
    st.timer = setTimer(() => void fire(id), delay);
  }

  return { push, pending: (id) => waiting.has(id) || running.has(id) };
}
