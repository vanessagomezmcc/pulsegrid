import { Page, expect } from '@playwright/test';

/** Enter the demo from the landing page and land on the Overview. */
export async function enterDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /enter live demo|resume live demo/i }).click();
  await expect(page).toHaveURL(/\/overview/);
  await expect(page.getByRole('heading', { name: 'System Overview' })).toBeVisible();
}

export async function runScenario(page: Page, name: RegExp) {
  await page.goto('/lab');
  const card = page.locator('.card', { hasText: name });
  await card.getByRole('button', { name: /run scenario|adjust intensity/i }).click();
  await expect(page.getByRole('status')).toContainText(/started|reset/i, { timeout: 10_000 });
}
