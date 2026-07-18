import { expect, test } from '@playwright/test';
import { enterDemo, runScenario } from './helpers';

test('severe error spike opens an incident; recovery resolves it', async ({ page }) => {
  test.setTimeout(360_000);
  await enterDemo(page);
  await page.goto('/lab');
  await page.getByLabel(/intensity/i).selectOption('3');
  await runScenario(page, /Payment Error Spike/i);

  await page.goto('/incidents');
  await expect
    .poll(async () => {
      await page.reload();
      return page.getByText('OPEN').count();
    }, { timeout: 180_000, intervals: [5_000] })
    .toBeGreaterThan(0);

  await runScenario(page, /Full Recovery/i);
  await page.goto('/incidents');
  await expect
    .poll(async () => {
      await page.reload();
      return page.getByText('OPEN').count();
    }, { timeout: 180_000, intervals: [5_000] })
    .toBe(0);
});
