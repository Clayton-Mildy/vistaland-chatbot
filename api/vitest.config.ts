import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL:
        process.env['TEST_DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:54329/vistaland_test',
      API_SECRET_KEY: 'test-secret-test-secret-test-secret-00',
      LOG_LEVEL: 'silent',
      MEDIA_DIR: 'tests/.media',
    },
    // DB tests truncate shared tables, so files must not run concurrently.
    fileParallelism: false,
    globalSetup: './tests/setup/migrate.ts',
  },
});
