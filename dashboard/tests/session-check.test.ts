import { it, expect, vi } from "vitest";
import { revalidateToken, RECHECK_MS } from "@/lib/sessionCheck";

const token = { id: "u1", role: "sales", name: "Sari", checkedAt: 0 };

it("ends the session when the account is deactivated or deleted", async () => {
  expect(await revalidateToken(token, RECHECK_MS + 1, async () => ({ isActive: false, role: "sales", displayName: "Sari" }))).toBeNull();
  expect(await revalidateToken(token, RECHECK_MS + 1, async () => null)).toBeNull();
});

it("picks up a role or name change and records the check time", async () => {
  const now = RECHECK_MS + 1;
  const t = await revalidateToken(token, now, async () => ({ isActive: true, role: "admin", displayName: "Sari W" }));
  expect(t).toEqual({ id: "u1", role: "admin", name: "Sari W", checkedAt: now });
});

it("does not look the account up again within the recheck window", async () => {
  const lookup = vi.fn();
  expect(await revalidateToken({ ...token, checkedAt: 1000 }, 1000 + RECHECK_MS - 1, lookup)).toEqual({ ...token, checkedAt: 1000 });
  expect(lookup).not.toHaveBeenCalled();
});

it("keeps the session when the API cannot be reached", async () => {
  expect(await revalidateToken(token, RECHECK_MS + 1, async () => "unavailable")).toEqual(token);
});
