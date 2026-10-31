"use server";

import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { resetTestChat, sendTestMessage, type TestChatResult } from "@/lib/api/testChat";

async function staffId(): Promise<string> {
  await requireAdmin();
  const id = (await auth())?.user?.id;
  if (!id) throw new Error("FORBIDDEN");
  return id;
}

export async function sendTestMessageAction(text: string): Promise<{ data?: TestChatResult; error?: string }> {
  const id = await staffId();
  try {
    return { data: await sendTestMessage(id, text) };
  } catch {
    return { error: "Uji chat gagal. Pastikan API berjalan." };
  }
}

export async function resetTestChatAction(): Promise<{ error?: string }> {
  const id = await staffId();
  try {
    await resetTestChat(id);
    return {};
  } catch {
    return { error: "Gagal memulai ulang." };
  }
}
