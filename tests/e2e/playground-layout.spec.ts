// The calibration controls of the input playground fit a 1280 by 720 window without scrolling. Simulated input only:
// the test chooses "Try without camera" and never requests a camera.
import { expect, test } from '@playwright/test';

const WINDOW = { width: 1280, height: 720 };

test.use({ viewport: WINDOW });

test('the calibration controls are inside the window at 1280 by 720, with no scrolling', async ({ page }) => {
  await page.goto('/?playground=1');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Try without camera' }).click();

  const whole = page.getByRole('button', { name: 'Use the whole screen' });
  await expect(whole).toBeVisible();
  const box = await whole.boundingBox();
  if (box === null) throw new Error('the whole-screen button has no box');
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(WINDOW.height);

  // The page itself and the screen that holds the controls do not scroll.
  const scrolls = await page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>('.playground-screen');
    return {
      page: document.documentElement.scrollHeight > window.innerHeight,
      screen: screen === null ? true : screen.scrollHeight > screen.clientHeight,
    };
  });
  expect(scrolls).toEqual({ page: false, screen: false });
});
