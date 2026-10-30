import { getStock, type TypeStock } from "@/lib/api/stock";
import { formatRupiahShort, formatWib } from "@/lib/format";
import { SyncButton } from "./SyncButton";

export const dynamic = "force-dynamic";

function priceRange(t: TypeStock): string {
  if (t.minPrice === null || t.maxPrice === null) return "—";
  if (t.minPrice === t.maxPrice) return formatRupiahShort(t.minPrice);
  return `${formatRupiahShort(t.minPrice)}–${formatRupiahShort(t.maxPrice)}`;
}

function landBuilding(t: TypeStock): string {
  const land =
    t.landSizeMin === null ? "—" : t.landSizeMax !== null && t.landSizeMax !== t.landSizeMin ? `${t.landSizeMin}–${t.landSizeMax}` : `${t.landSizeMin}`;
  return `${land}/${t.buildingSize ?? "—"} m²`;
}

function notes(t: TypeStock): string {
  const out: string[] = [];
  if (t.unpricedAvailable > 0) out.push(`${t.unpricedAvailable} unit tanpa harga`);
  if (t.outOfPeriodAvailable > 0) out.push(`${t.outOfPeriodAvailable} di luar periode price list`);
  return out.join(" · ");
}

export default async function StockPage() {
  const stock = await getStock();
  const unitsState = stock.syncStates.find((s) => s.endpoint === "units");
  const failing = stock.syncStates.filter((s) => s.lastError);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stok Unit</h1>
        <SyncButton />
      </div>

      {stock.stale && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {unitsState?.lastOkAt
            ? `Data VLES terakhir berhasil disinkron ${formatWib(unitsState.lastOkAt)} — lebih dari 2 jam lalu.`
            : "Data VLES belum pernah berhasil disinkron."}
        </div>
      )}
      {failing.length > 0 && (
        <div className="space-y-1 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {failing.map((s) => (
            <p key={s.endpoint}>
              {s.endpoint}: {s.lastError}
            </p>
          ))}
        </div>
      )}
      {!stock.stale && unitsState?.lastOkAt && (
        <p className="text-xs text-slate-500">Terakhir disinkron {formatWib(unitsState.lastOkAt)}</p>
      )}

      {stock.projects.map((p) => (
        <section key={p.projectId} className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="font-semibold">
            {p.displayName} — {p.availableUnits} unit tersedia dari {p.totalUnits}
          </h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-3">Tipe</th>
                <th className="py-1 pr-3">LT/LB</th>
                <th className="py-1 pr-3">Kategori</th>
                <th className="py-1 pr-3">Tersedia</th>
                <th className="py-1 pr-3">Harga</th>
                <th className="py-1">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {p.types.map((t) => (
                <tr key={t.houseTypeId} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3">{t.houseTypeName}</td>
                  <td className="py-1.5 pr-3">{landBuilding(t)}</td>
                  <td className="py-1.5 pr-3">{t.salesCategory ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    {t.availableUnits}/{t.totalUnits}
                  </td>
                  <td className="py-1.5 pr-3">{priceRange(t)}</td>
                  <td className="py-1.5 text-slate-600">{notes(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {stock.unassignedAreas.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-white p-4">
          <h2 className="font-semibold">Area VLES belum dipetakan</h2>
          <p className="mt-1 text-sm text-slate-600">
            Unit di area ini tidak ditawarkan Moni sampai area dipetakan ke proyek.
          </p>
          <ul className="mt-2 text-sm">
            {stock.unassignedAreas.map((a) => (
              <li key={`${a.vlesProjectId}-${a.areaId}`}>
                {a.areaName} (proyek VLES {a.vlesProjectId}, area {a.areaId}) — {a.availableUnits} tersedia dari {a.units}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
