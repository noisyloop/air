import { defineConfig } from '@playwright/test';

/**
 * E2E tests expect the dev stack to be running:
 *   docker compose up -d postgres redis minio meilisearch
 *   npm run db:migrate && npm run db:seed
 *   npm run dev:api & npm run dev:web
 * Then: npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
    // Point at a system Chromium instead of downloading one (e.g. sandboxed CI).
    ...(process.env.PW_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } } : {}),
  },
});
