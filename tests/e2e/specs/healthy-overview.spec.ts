import { expect, test } from '@playwright/test';
import { enterDemo } from './helpers';

test('healthy system shows all four services with live metrics', async ({ page }) => {
  await enterDemo(page);
  for (const svc of ['Auth', 'Payments', 'Orders', 'Notifications']) {
    await expect(page.getByText(svc, { exact: false }).first()).toBeVisible();
  }
  // Live totals populate once the processor publishes (≤ ~10 s after boot).
  await expect(page.getByText(/rps/).first()).toBeVisible({ timeout: 30_000 });
});
