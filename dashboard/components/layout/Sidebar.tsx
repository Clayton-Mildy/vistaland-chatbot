import Link from "next/link";
import { signOut, type Role } from "@/lib/auth";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", sales: "Sales" };

// Later milestones add Leads, Jadwal, Percakapan, and the rest here.
const ITEMS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/", label: "Beranda" },
  { href: "/stock", label: "Stok Unit", adminOnly: true },
  { href: "/staff", label: "Staf", adminOnly: true },
];

export function Sidebar({ role, userName }: { role: Role | null; userName: string }) {
  return (
    <nav className="flex h-full flex-col gap-1 p-4">
      <p className="px-2 text-sm font-bold tracking-wide text-brand-700">VISTA LAND · MONI</p>
      <div className="mb-4 px-2 text-xs text-slate-500">
        {userName} · {role ? ROLE_LABEL[role] : "-"}
      </div>
      {ITEMS.filter((i) => !i.adminOnly || role === "admin").map((i) => (
        <Link key={i.href} href={i.href} className="rounded px-2 py-1.5 text-sm hover:bg-slate-200">
          {i.label}
        </Link>
      ))}
      <form
        className="mt-auto"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-200">
          Keluar
        </button>
      </form>
    </nav>
  );
}
