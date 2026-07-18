import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  retries: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'retain-on-failure' },
  workers: 1, // scenarios mutate session state; keep runs serial
});
