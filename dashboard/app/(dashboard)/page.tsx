import { auth } from "@/lib/auth";
import { sessionRole } from "@/lib/session";

export default async function HomePage() {
  const session = await auth();
  const role = await sessionRole();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Selamat datang, {session?.user?.name ?? "Pengguna"}</h1>
      <p className="mt-1 text-sm text-slate-600">Peran: {role === "admin" ? "Admin" : role === "sales" ? "Sales" : "-"}</p>
    </div>
  );
}
