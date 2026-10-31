import { apiFetch } from "./client";
import type { Lead } from "./leads";

export type TraceEntry = { tool: string; input: unknown; isError: boolean; output: string };
export type TestChatResult = {
  outbound: { kind: string; body?: string; link?: string }[];
  outcome: "replied" | "no_reply" | "skipped" | "failed" | "canned";
  trace: TraceEntry[];
  failure: string | null;
  lead: Lead | null;
};

export async function sendTestMessage(staffId: string, text: string): Promise<TestChatResult> {
  const res = await apiFetch<TestChatResult>(`/test-chat/${staffId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
  if (!res.data) throw new Error("Empty test chat response");
  return res.data;
}

export const resetTestChat = (staffId: string) => apiFetch(`/test-chat/${staffId}`, { method: "DELETE" });
