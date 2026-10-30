// Sessions are JWTs that live for 30 days, and the account is otherwise only checked at login.
// Re-check it every few minutes so deactivating staff (or changing their role) takes effect
// promptly instead of at expiry.

export const RECHECK_MS = Number(process.env.SESSION_RECHECK_MS ?? 5 * 60_000);

export type StaffLookupResult = { isActive: boolean; role: string; displayName: string } | null | "unavailable";

type SessionToken = { id?: string; role?: string; name?: string | null; checkedAt?: number };

/**
 * Returns the token to keep (possibly refreshed), or null to end the session. An API outage
 * keeps the session: logging every user out because the API blinked would be worse.
 */
export async function revalidateToken<T extends SessionToken>(
  token: T,
  now: number,
  lookup: (id: string) => Promise<StaffLookupResult>
): Promise<T | null> {
  if (!token.id) return token;
  if (token.checkedAt !== undefined && now - token.checkedAt < RECHECK_MS) return token;
  const staff = await lookup(token.id);
  if (staff === "unavailable") return token;
  if (staff === null || !staff.isActive) return null;
  return { ...token, role: staff.role, name: staff.displayName, checkedAt: now };
}
