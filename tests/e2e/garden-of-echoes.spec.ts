import { expect, test } from '@playwright/test';

test('loads the page with the app name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Garden of Echoes' })).toBeVisible();
});