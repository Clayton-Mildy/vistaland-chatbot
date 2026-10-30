import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { revalidateToken, type StaffLookupResult } from "@/lib/sessionCheck";

export type Role = "admin" | "sales";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const apiUrl = () => process.env.API_INTERNAL_URL ?? "http://localhost:50060";

async function lookupStaff(id: string): Promise<StaffLookupResult> {
  try {
    const res = await fetch(`${apiUrl()}/api/v1/staff/${id}`, {
      headers: { Authorization: `Bearer ${process.env.API_SECRET_KEY ?? ""}` },
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) return "unavailable";
    return (await res.json()).data;
  } catch {
    return "unavailable";
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const apiKey = process.env.API_SECRET_KEY;
        if (!apiKey) {
          console.error("[auth] API_SECRET_KEY is not set");
          return null;
        }

        try {
          const res = await fetch(`${apiUrl()}/api/v1/auth/verify-credentials`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(parsed.data),
            cache: "no-store",
          });
          if (!res.ok) return null;
          const user = (await res.json()).data;
          if (!user?.id || !user?.email) return null;
          return { id: user.id, email: user.email, name: user.displayName, role: user.role };
        } catch (err) {
          console.error("[auth] verify-credentials request failed:", err);
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.checkedAt = Date.now();
        return token;
      }
      return revalidateToken(token, Date.now(), lookupStaff);
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
});
