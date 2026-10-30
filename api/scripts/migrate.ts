/**
 * Applies pending migrations with drizzle-orm's runtime migrator (same journal and bookkeeping
 * table as `drizzle-kit migrate`). drizzle-kit is a devDependency; this runs on production deps.
 *
 *   npm run db:migrate                    (dev, from api/)
 *   node dist-scripts/migrate.js          (container; MIGRATIONS_DIR=./migrations)
 */
import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, closeDb } from '../src/db/client.js';

const migrationsFolder = process.env['MIGRATIONS_DIR'] ?? './src/db/migrations';

await migrate(getDb(), { migrationsFolder });
await closeDb();
console.log(`Migrations applied from ${migrationsFolder}`);
