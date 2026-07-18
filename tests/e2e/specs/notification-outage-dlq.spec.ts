import { expect, test } from '@playwright/test';
import { enterDemo, runScenario } from './helpers';

test('notification outage fills the DLQ; recovery allows a successful retry', async ({ page }) => {
  test.setTimeout(240_000);
  await enterDemo(page);
  await runScenario(page, /Notification Outage/i);
  await page.goto('/dead-letter');
  await expect
    .poll(async () => {
      await page.reload();
      return page.getByText('notification_delivery').count();
    }, { timeout: 120_000, intervals: [5_000] })
    .toBeGreaterThan(0);

  await runScenario(page, /Full Recovery/i);
  await page.goto('/dead-letter');
  const retry = page.getByRole('button', { name: 'Retry' }).first();
  await retry.click();
  await expect(page.getByRole('status')).toContainText(/re-delivered/i, { timeout: 15_000 });
});
