import "next-auth";

declare module "next-auth" {
  interface User {
    id?: string;
    role?: string;
  }

  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    // When the account was last re-checked against the API (lib/sessionCheck.ts).
    checkedAt?: number;
  }
}
