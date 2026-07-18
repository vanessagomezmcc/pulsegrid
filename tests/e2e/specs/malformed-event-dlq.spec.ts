import { expect, test } from '@playwright/test';
import { enterDemo, runScenario } from './helpers';

test('malformed event lands in the DLQ with validation errors', async ({ page }) => {
  await enterDemo(page);
  await runScenario(page, /Malformed Event/i);
  await page.goto('/dead-letter');
  await expect
    .poll(async () => {
      await page.reload();
      return page.getByText('invalid_telemetry').count();
    }, { timeout: 60_000, intervals: [3_000] })
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Inspect' }).first().click();
  await expect(page.getByText(/eventVersion|required/i).first()).toBeVisible();
});
