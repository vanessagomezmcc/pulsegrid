import { expect, test } from '@playwright/test';
import { enterDemo, runScenario } from './helpers';

test('payment slowdown drives the latency alert to firing', async ({ page }) => {
  test.setTimeout(240_000);
  await enterDemo(page);
  await runScenario(page, /Payment Slowdown/i);
  await page.goto('/alerts');
  // pending needs 20 s sustained breach on top of window fill; poll patiently.
  await expect
    .poll(async () => {
      await page.reload();
      return page.getByText(/^firing$/).count();
    }, { timeout: 180_000, intervals: [5_000] })
    .toBeGreaterThan(0);
});
