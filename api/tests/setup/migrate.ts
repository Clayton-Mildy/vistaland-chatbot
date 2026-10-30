import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Same URL vitest.config.ts hands the test workers.
const url = process.env['TEST_DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:54329/vistaland_test';

export async function setup(): Promise<void> {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './src/db/migrations' });
  } finally {
    await pool.end();
  }
}
