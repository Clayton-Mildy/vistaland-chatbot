import { sql } from 'drizzle-orm';
import { getDb } from '../../src/db/client.js';

/** Empties the named tables in one statement, resetting identities. */
export async function truncate(...tables: string[]): Promise<void> {
  const list = tables.map((t) => `"${t}"`).join(', ');
  await getDb().execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
}
