/**
 * Records the VLES responses the tests replay. Read-only GETs; no customer data is fetched
 * (units, types, promos and banks only).
 *
 *   VLES_API_KEY=$(security find-generic-password -s vles-api-key-dev -w) npx tsx scripts/record-vles-fixtures.ts
 */
import { writeFileSync, mkdirSync } from 'fs';
import { createVlesClient } from '../src/vles/client.js';
import { VlesUnitRaw } from '../src/vles/types.js';

const apiKey = process.env['VLES_API_KEY'];
if (!apiKey) {
  console.error('VLES_API_KEY is required');
  process.exit(1);
}
const client = createVlesClient({
  baseUrl: process.env['VLES_BASE_URL'] ?? 'https://vles.vistalandapp.com/api/v1/integration',
  apiKey,
  maxRequestsPerMinute: 60,
});

const dir = new URL('../tests/fixtures/vles/', import.meta.url);
mkdirSync(dir, { recursive: true });
const write = (name: string, body: unknown) => {
  writeFileSync(new URL(name, dir), JSON.stringify(body, null, 2) + '\n');
  console.log(`wrote ${name}`);
};

const EPOCH = '2000-01-01T00:00:00+07:00';

const page1 = await client.listPage('units', { updatedSince: EPOCH, limit: 3 });
write('units-page-1.json', page1);
if (!page1.page.next_cursor) throw new Error('expected a second units page');
write('units-page-2.json', await client.listPage('units', { updatedSince: EPOCH, limit: 3, cursor: page1.page.next_cursor }));

const units1 = page1.data.map((r) => VlesUnitRaw.parse(r));
const notForSale = units1.find((u) => !u.is_available_for_sale);
if (notForSale) write('unit-detail-not-for-sale.json', await client.getUnit(notForSale.id));

let cursor: string | undefined;
let forSaleId: number | undefined;
while (forSaleId === undefined) {
  const page = await client.listPage('units', { updatedSince: EPOCH, limit: 500, cursor });
  forSaleId = page.data.map((r) => VlesUnitRaw.parse(r)).find((u) => u.is_available_for_sale && !u.deleted)?.id;
  if (!page.page.next_cursor) break;
  cursor = page.page.next_cursor;
}
if (forSaleId === undefined) throw new Error('no unit for sale found');
write('unit-detail-for-sale.json', await client.getUnit(forSaleId));

write('unit-types.json', await client.listPage('unit-types', { updatedSince: EPOCH, limit: 5 }));
write('promos.json', await client.listPage('promos', { updatedSince: EPOCH, limit: 5 }));
write('mortgage-banks.json', await client.listPage('mortgage-banks', { updatedSince: EPOCH, limit: 5 }));

write('units-tombstone.json', {
  data: [{ id: units1[0]!.id, project_id: 5, deleted: true, changed_at: '2026-10-30T10:00:00+07:00' }],
  page: { limit: 500, next_cursor: null },
  sync: {
    server_time: '2026-10-30T10:05:00+07:00',
    updated_since: '2026-10-30T09:00:00+07:00',
    effective_since: '2026-10-30T02:00:00+07:00',
    lookback_hours: 7,
  },
});
