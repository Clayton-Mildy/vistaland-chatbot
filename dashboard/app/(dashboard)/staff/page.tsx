import { listStaff } from "@/lib/api/staff";
import { StaffClient } from "./StaffClient";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const staff = await listStaff();
  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Staf</h1>
      <StaffClient staff={staff} />
    </div>
  );
}
