import { getSettings, listPromptVersions } from "@/lib/api/settings";
import { listStaff } from "@/lib/api/staff";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, versions, staff] = await Promise.all([getSettings(), listPromptVersions(), listStaff()]);
  const names = Object.fromEntries(staff.map((s) => [s.id, s.displayName]));
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Pengaturan</h1>
      <SettingsForm settings={settings} versions={versions.map((v) => ({ ...v, author: v.createdBy ? (names[v.createdBy] ?? "Staf") : "Sistem" }))} />
    </div>
  );
}
