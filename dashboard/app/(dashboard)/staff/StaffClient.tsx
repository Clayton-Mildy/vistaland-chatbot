"use client";

import { useState, useTransition } from "react";
import { createStaffAction, updateStaffAction, resetStaffPasswordAction } from "@/actions/staffActions";
import type { Staff, StaffRole } from "@/lib/api/staff";

const ROLE_LABEL: Record<StaffRole, string> = { admin: "Admin", sales: "Sales" };
const input = "h-9 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-600 focus:outline-none";

export function StaffClient({ staff }: { staff: Staff[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: "", email: "", role: "sales" as StaffRole, password: "" });

  const run = (fn: () => Promise<{ error?: string }>, success?: string) =>
    startTransition(async () => {
      setError(null);
      setNote(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else if (success) setNote(success);
    });

  return (
    <div className="space-y-6">
      <table className="w-full rounded-lg bg-white text-left text-sm shadow-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Nama</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Peran</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id} className="border-t border-slate-100">
              <td className="px-3 py-2">{s.displayName}</td>
              <td className="px-3 py-2">{s.email}</td>
              <td className="px-3 py-2">{ROLE_LABEL[s.role]}</td>
              <td className="px-3 py-2">{s.isActive ? "Aktif" : "Nonaktif"}</td>
              <td className="space-x-2 px-3 py-2 text-right">
                <button
                  type="button"
                  disabled={pending}
                  className="text-brand-700 hover:underline"
                  onClick={() => run(() => updateStaffAction(s.id, { isActive: !s.isActive }))}
                >
                  {s.isActive ? "Nonaktifkan" : "Aktifkan"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="text-brand-700 hover:underline"
                  onClick={() => {
                    const pw = window.prompt(`Kata sandi baru untuk ${s.displayName} (min. 12 karakter)`);
                    if (pw) run(() => resetStaffPasswordAction(s.id, pw), "Kata sandi diperbarui.");
                  }}
                >
                  Atur ulang kata sandi
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        className="space-y-3 rounded-lg bg-white p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await createStaffAction(form);
            if (!r.error) setForm({ displayName: "", email: "", role: "sales", password: "" });
            return r;
          }, "Staf ditambahkan.");
        }}
      >
        <h2 className="font-semibold">Tambah staf</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Nama
            <input className={input} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
          </label>
          <label className="text-sm">
            Email
            <input className={input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label className="text-sm">
            Peran
            <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
              <option value="sales">Sales</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="text-sm">
            Kata sandi (min. 12 karakter)
            <input className={input} type="password" minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </label>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {note && <p className="text-sm text-brand-700">{note}</p>}
        <button type="submit" disabled={pending} className="h-9 rounded bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          Tambah staf
        </button>
      </form>
    </div>
  );
}
