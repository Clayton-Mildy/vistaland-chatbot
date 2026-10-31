"use client";

import { useState, useTransition } from "react";
import {
  createMaterialAction,
  deactivateMaterialAction,
  deleteChannelTagAction,
  saveChannelTagAction,
  savePromoCopyAction,
  saveTypeProfileAction,
  updateProjectAction,
} from "@/actions/catalogActions";
import {
  MATERIAL_KINDS,
  MATERIAL_LABEL,
  type ChannelTag,
  type GalleryHours,
  type Material,
  type MaterialKind,
  type Project,
  type ProjectPromo,
  type ProjectType,
} from "@/lib/api/catalog";

const input = "h-9 w-full rounded border border-slate-300 px-2 text-sm focus:border-brand-600 focus:outline-none";
const area = "w-full rounded border border-slate-300 p-2 text-sm focus:border-brand-600 focus:outline-none";
const button = "h-9 rounded bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60";
const link = "text-sm text-brand-700 hover:underline disabled:opacity-60";
const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

/** Runs a server action and keeps its pending state and outcome message. */
function useAction() {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ error?: string; note?: string }>({});
  const run = (fn: () => Promise<{ error?: string }>, note = "Tersimpan.") =>
    start(async () => {
      setStatus({});
      const r = await fn();
      setStatus(r.error ? { error: r.error } : { note });
    });
  const message = status.error ? (
    <p className="text-sm text-red-700">{status.error}</p>
  ) : status.note ? (
    <p className="text-sm text-brand-700">{status.note}</p>
  ) : null;
  return { pending, run, message, fail: (error: string) => setStatus({ error }) };
}

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
const intOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

// ─── Profil ─────────────────────────────────────────────────────────────────

export function ProfileForm({ project }: { project: Project }) {
  const { pending, run, message } = useAction();
  const [f, setF] = useState({
    displayName: project.displayName,
    personaTeamName: project.personaTeamName,
    locationLabel: project.locationLabel ?? "",
    mapsUrl: project.mapsUrl ?? "",
    accessNotes: project.accessNotes ?? "",
    visitMinutes: String(project.visitMinutes),
    sameDayMinNoticeMinutes: String(project.sameDayMinNoticeMinutes),
    vlesAreaIds: project.vlesAreaIds.join(", "),
    subsidiNotes: project.subsidiNotes ?? "",
    active: project.active,
  });
  const [hours, setHours] = useState<GalleryHours>(project.galleryHours ?? {});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const day = (d: number) => String(d) as keyof GalleryHours;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          updateProjectAction(project.id, {
            displayName: f.displayName,
            personaTeamName: f.personaTeamName,
            locationLabel: orNull(f.locationLabel),
            mapsUrl: orNull(f.mapsUrl),
            accessNotes: orNull(f.accessNotes),
            galleryHours: hours,
            visitMinutes: Number(f.visitMinutes),
            sameDayMinNoticeMinutes: Number(f.sameDayMinNoticeMinutes),
            vlesAreaIds: f.vlesAreaIds.split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0),
            subsidiNotes: orNull(f.subsidiNotes),
            active: f.active,
          })
        );
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">Nama tampilan<input className={input} value={f.displayName} onChange={set("displayName")} required /></label>
        <label className="text-sm">Nama persona (contoh: tim Zetira)<input className={input} value={f.personaTeamName} onChange={set("personaTeamName")} required /></label>
        <label className="text-sm">Lokasi<input className={input} value={f.locationLabel} onChange={set("locationLabel")} /></label>
        <label className="text-sm">Link Maps<input className={input} type="url" value={f.mapsUrl} onChange={set("mapsUrl")} /></label>
        <label className="col-span-2 text-sm">Catatan akses<textarea className={area} rows={2} value={f.accessNotes} onChange={set("accessNotes")} /></label>
        <label className="text-sm">Durasi kunjungan (menit)<input className={input} type="number" min={15} max={480} value={f.visitMinutes} onChange={set("visitMinutes")} /></label>
        <label className="text-sm">Minimal pemberitahuan kunjungan hari yang sama (menit)<input className={input} type="number" min={0} max={1440} value={f.sameDayMinNoticeMinutes} onChange={set("sameDayMinNoticeMinutes")} /></label>
        <label className="text-sm">Area VLES (id, pisahkan koma)<input className={input} value={f.vlesAreaIds} onChange={set("vlesAreaIds")} /></label>
        <label className="flex items-end gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Proyek aktif</label>
        <label className="col-span-2 text-sm">Catatan subsidi (dikutip Moni apa adanya)<textarea className={area} rows={2} value={f.subsidiNotes} onChange={set("subsidiNotes")} /></label>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold">Jam galeri</legend>
        {DAYS.map((name, i) => {
          const h = hours[day(i + 1)];
          const closed = h === null;
          return (
            <div key={name} className="flex items-center gap-2 text-sm">
              <span className="w-20">{name}</span>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={closed} onChange={(e) => setHours({ ...hours, [day(i + 1)]: e.target.checked ? null : ["09:00", "17:00"] })} /> Tutup
              </label>
              {!closed && (
                <>
                  <input className="h-8 rounded border border-slate-300 px-1" type="time" value={h?.[0] ?? ""} onChange={(e) => setHours({ ...hours, [day(i + 1)]: [e.target.value, h?.[1] ?? "17:00"] })} />
                  –
                  <input className="h-8 rounded border border-slate-300 px-1" type="time" value={h?.[1] ?? ""} onChange={(e) => setHours({ ...hours, [day(i + 1)]: [h?.[0] ?? "09:00", e.target.value] })} />
                </>
              )}
            </div>
          );
        })}
      </fieldset>
      {message}
      <button type="submit" disabled={pending} className={button}>Simpan profil</button>
    </form>
  );
}

// ─── Tipe ───────────────────────────────────────────────────────────────────

function TypeRow({ project, t }: { project: Project; t: ProjectType }) {
  const { pending, run, message } = useAction();
  const p = t.profile;
  const [f, setF] = useState({
    marketingName: p?.marketingName ?? "",
    bedrooms: p?.bedrooms?.toString() ?? "",
    bathrooms: p?.bathrooms?.toString() ?? "",
    floors: p?.floors?.toString() ?? "",
    highlights: p?.highlights ?? "",
    active: p?.active ?? true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="py-2 pr-2">
        <div className="font-medium">{t.houseTypeName}</div>
        <div className="text-xs text-slate-500">id {t.houseTypeId} · {t.salesCategory ?? "—"} · {t.availableUnits}/{t.totalUnits} tersedia</div>
        {f.bedrooms === "" && <div className="text-xs text-amber-700">Kamar tidur belum diisi — Moni tidak bisa menyaring tipe ini</div>}
      </td>
      <td className="py-2 pr-2"><input className={input} value={f.marketingName} onChange={set("marketingName")} placeholder="Nama pemasaran" /></td>
      <td className="w-16 py-2 pr-2"><input className={input} type="number" min={0} max={10} value={f.bedrooms} onChange={set("bedrooms")} /></td>
      <td className="w-16 py-2 pr-2"><input className={input} type="number" min={0} max={10} value={f.bathrooms} onChange={set("bathrooms")} /></td>
      <td className="w-16 py-2 pr-2"><input className={input} type="number" min={1} max={5} value={f.floors} onChange={set("floors")} /></td>
      <td className="py-2 pr-2"><input className={input} value={f.highlights} onChange={set("highlights")} placeholder="Keunggulan" /></td>
      <td className="py-2 pr-2 text-center"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /></td>
      <td className="py-2">
        <button
          type="button"
          disabled={pending}
          className={link}
          onClick={() =>
            run(() =>
              saveTypeProfileAction(project.id, t.houseTypeId, {
                projectId: project.id,
                marketingName: orNull(f.marketingName),
                bedrooms: intOrNull(f.bedrooms),
                bathrooms: intOrNull(f.bathrooms),
                floors: intOrNull(f.floors),
                highlights: orNull(f.highlights),
                active: f.active,
              })
            )
          }
        >
          Simpan
        </button>
        {message}
      </td>
    </tr>
  );
}

export function TypesPanel({ project, types }: { project: Project; types: ProjectType[] }) {
  if (types.length === 0) return <p className="text-sm text-slate-600">Belum ada tipe dari VLES di area proyek ini.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase text-slate-500">
        <tr><th>Tipe VLES</th><th>Nama pemasaran</th><th>KT</th><th>KM</th><th>Lantai</th><th>Keunggulan</th><th>Aktif</th><th /></tr>
      </thead>
      <tbody>{types.map((t) => <TypeRow key={t.houseTypeId} project={project} t={t} />)}</tbody>
    </table>
  );
}

// ─── Materi ─────────────────────────────────────────────────────────────────

export function MaterialsPanel({ project, materials, types }: { project: Project; materials: Material[]; types: ProjectType[] }) {
  const { pending, run, message, fail } = useAction();
  const [form, setForm] = useState({ kind: "flyer" as MaterialKind, houseTypeId: "", validFrom: "", validTo: "", sort: "0" });
  const [file, setFile] = useState<File | null>(null);
  const typeName = (id: number | null) => (id === null ? "Semua tipe" : (types.find((t) => t.houseTypeId === id)?.houseTypeName ?? `tipe ${id}`));

  async function upload() {
    if (!file) return fail("Pilih file dulu.");
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body });
    const json = (await res.json().catch(() => null)) as { data?: { url: string; mime: string; filename: string }; error?: string } | null;
    if (!res.ok || !json?.data) {
      const code = json?.error;
      return fail(code === "UNSUPPORTED_TYPE" ? "Format tidak didukung. Pakai JPG, PNG, MP4, atau PDF." : code === "TOO_LARGE" ? "File melebihi 16 MB." : "Gagal mengunggah file.");
    }
    run(
      () =>
        createMaterialAction({
          projectId: project.id,
          houseTypeId: form.houseTypeId ? Number(form.houseTypeId) : null,
          kind: form.kind,
          url: json.data!.url,
          mime: json.data!.mime,
          filename: json.data!.filename,
          validFrom: form.validFrom || null,
          validTo: form.validTo || null,
          sort: Number(form.sort) || 0,
        }),
      "Materi ditambahkan."
    );
    setFile(null);
  }

  return (
    <div className="space-y-6">
      {MATERIAL_KINDS.map((kind) => {
        const rows = materials.filter((m) => m.kind === kind);
        if (rows.length === 0) return null;
        return (
          <section key={kind}>
            <h3 className="mb-2 font-semibold">{MATERIAL_LABEL[kind]}</h3>
            <ul className="space-y-2">
              {rows.map((m) => (
                <li key={m.id} className={`flex items-center gap-3 text-sm ${m.active ? "" : "opacity-50"}`}>
                  {m.mime.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.filename} className="h-14 w-14 rounded object-cover" />
                  ) : (
                    <a href={m.url} target="_blank" rel="noreferrer" className="flex h-14 w-14 items-center justify-center rounded bg-slate-100 text-xs text-brand-700">
                      {m.mime.startsWith("video/") ? "Video" : "PDF"}
                    </a>
                  )}
                  <div className="flex-1">
                    <div>{m.filename}</div>
                    <div className="text-xs text-slate-500">
                      {typeName(m.houseTypeId)} · urutan {m.sort} · berlaku {m.validFrom ?? "—"} s/d {m.validTo ?? "—"}
                      {!m.active && " · nonaktif"}
                    </div>
                  </div>
                  {m.active && (
                    <button type="button" disabled={pending} className={link} onClick={() => run(() => deactivateMaterialAction(project.id, m.id), "Materi dinonaktifkan.")}>
                      Nonaktifkan
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {materials.length === 0 && <p className="text-sm text-slate-600">Belum ada materi. Moni tidak bisa mengirim flyer atau video sampai materi diunggah.</p>}

      <form className="space-y-3 border-t border-slate-200 pt-4" onSubmit={(e) => { e.preventDefault(); void upload(); }}>
        <h3 className="font-semibold">Unggah materi</h3>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-sm">Jenis
            <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MaterialKind })}>
              {MATERIAL_KINDS.map((k) => <option key={k} value={k}>{MATERIAL_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="text-sm">Tipe (opsional)
            <select className={input} value={form.houseTypeId} onChange={(e) => setForm({ ...form, houseTypeId: e.target.value })}>
              <option value="">Semua tipe</option>
              {types.map((t) => <option key={t.houseTypeId} value={t.houseTypeId}>{t.houseTypeName}</option>)}
            </select>
          </label>
          <label className="text-sm">File (JPG, PNG, MP4, PDF, maks. 16 MB)
            <input className="block w-full text-sm" type="file" accept="image/jpeg,image/png,video/mp4,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="text-sm">Berlaku dari<input className={input} type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} /></label>
          <label className="text-sm">Berlaku sampai<input className={input} type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} /></label>
          <label className="text-sm">Urutan<input className={input} type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })} /></label>
        </div>
        {message}
        <button type="submit" disabled={pending} className={button}>Unggah</button>
      </form>
    </div>
  );
}

// ─── Promo ──────────────────────────────────────────────────────────────────

function PromoRow({ project, p }: { project: Project; p: ProjectPromo }) {
  const { pending, run, message } = useAction();
  const [text, setText] = useState(p.customerText ?? "");
  const [terms, setTerms] = useState(p.termsText ?? "");
  const benefit = p.benefitAmount !== null ? `Rp${p.benefitAmount.toLocaleString("id-ID")}` : p.benefitPercent !== null ? `${p.benefitPercent}%` : "—";
  return (
    <li className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{p.name}</span>
          <span className="ml-2 text-xs text-slate-500">{p.salesCategory ?? "—"} · {benefit} · {p.validFrom ?? "—"} s/d {p.validTo ?? "—"}</span>
        </div>
        <span className={`rounded px-2 text-xs ${p.isUsable ? "bg-brand-100 text-brand-700" : "bg-slate-200"}`}>{p.isUsable ? "Berlaku" : "Tidak berlaku"}</span>
      </div>
      {p.isUsable && !p.customerText && <p className="text-xs text-amber-700">Belum ada kalimat — Moni hanya menyebut nama dan nilai promo</p>}
      <label className="block text-sm">Kalimat untuk pelanggan<textarea className={area} rows={2} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <label className="block text-sm">Syarat<textarea className={area} rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} /></label>
      <button type="button" disabled={pending || !text.trim()} className={link} onClick={() => run(() => savePromoCopyAction(project.id, p.id, text, orNull(terms)))}>
        Simpan
      </button>
      {message}
    </li>
  );
}

export function PromosPanel({ project, promos }: { project: Project; promos: ProjectPromo[] }) {
  if (promos.length === 0) return <p className="text-sm text-slate-600">Belum ada promo dari VLES untuk proyek ini.</p>;
  return <ul className="space-y-3">{promos.map((p) => <PromoRow key={p.id} project={project} p={p} />)}</ul>;
}

// ─── Tag iklan ──────────────────────────────────────────────────────────────

const CHANNEL_LABEL = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", other: "Lainnya" } as const;
const KIND_LABEL = { promo: "Promo", reels: "Reels/video", general: "Umum" } as const;

export function TagsPanel({ project, tags }: { project: Project; tags: ChannelTag[] }) {
  const { pending, run, message } = useAction();
  const [f, setF] = useState<{ tag: string; channel: ChannelTag["channel"]; contentKind: ChannelTag["contentKind"] }>({ tag: "", channel: "instagram", contentKind: "promo" });
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Tambahkan tag di teks pesan otomatis iklan, contoh: <code>[ZTR-REELS] Halo, saya mau info promo</code>.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500"><tr><th>Tag</th><th>Kanal</th><th>Jenis konten</th><th /></tr></thead>
        <tbody>
          {tags.map((t) => (
            <tr key={t.tag} className="border-t border-slate-100">
              <td className="py-1.5 font-mono">[{t.tag}]</td>
              <td>{CHANNEL_LABEL[t.channel]}</td>
              <td>{KIND_LABEL[t.contentKind]}</td>
              <td className="text-right">
                <button type="button" disabled={pending} className={link} onClick={() => run(() => deleteChannelTagAction(project.id, t.tag), "Tag dihapus.")}>Hapus</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveChannelTagAction({ projectId: project.id, tag: f.tag.toUpperCase(), channel: f.channel, contentKind: f.contentKind }), "Tag disimpan.");
          setF({ ...f, tag: "" });
        }}
      >
        <label className="text-sm">Tag (huruf, angka, -)<input className={input} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} pattern="[A-Za-z0-9-]{2,24}" required /></label>
        <label className="text-sm">Kanal
          <select className={input} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as ChannelTag["channel"] })}>
            {Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-sm">Jenis konten
          <select className={input} value={f.contentKind} onChange={(e) => setF({ ...f, contentKind: e.target.value as ChannelTag["contentKind"] })}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button type="submit" disabled={pending} className={button}>Tambah tag</button>
      </form>
      {message}
    </div>
  );
}
