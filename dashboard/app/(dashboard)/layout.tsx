import { Sidebar } from "@/components/layout/Sidebar";
import { auth } from "@/lib/auth";
import { sessionRole } from "@/lib/session";
import { getPushPublicKey } from "@/lib/api/push";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = await sessionRole();
  // Push being off, or the API being down, only hides the toggle.
  const pushPublicKey = await getPushPublicKey().catch(() => null);
  const userName = session?.user?.name ?? session?.user?.email ?? "Pengguna";

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 flex-shrink-0 border-r border-slate-200 bg-slate-50">
        <Sidebar role={role} userName={userName} pushPublicKey={pushPublicKey} />
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
