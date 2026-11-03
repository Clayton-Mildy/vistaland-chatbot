import { auth, type Role } from "@/lib/auth";

/** The signed-in user's role, or null when there is no session. */
export async function sessionRole(): Promise<Role | null> {
  const session = await auth();
  const role = session?.user?.role;
  return role === "admin" || role === "sales" ? role : null;
}

/**
 * Hiding a button is not enforcement: a "use server" action is a POST endpoint any signed-in
 * session can call. Every admin action calls this first.
 */
export async function requireAdmin(): Promise<void> {
  if ((await sessionRole()) !== "admin") throw new Error("FORBIDDEN");
}

/** The signed-in account's id and role, or null when there is no session. */
export async function sessionUser(): Promise<{ id: string; role: Role } | null> {
  const session = await auth();
  const id = session?.user?.id;
  const role = session?.user?.role;
  return id && (role === "admin" || role === "sales") ? { id, role } : null;
}

/** For actions any signed-in staff member may call (admin or sales). */
export async function requireSignedIn(): Promise<{ id: string; role: Role }> {
  const user = await sessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}
