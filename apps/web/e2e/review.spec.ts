/**
 * Review mode: Ctrl+Shift+F hides the chrome, the floating bar navigates pages, the laser
 * dot follows the pointer, Escape leaves. Menu bar exposes the same entry.
 */

import { expect, test } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

async function twoPages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i += 1) {
    const page = doc.addPage([1000, 700]);
    page.drawRectangle({
      x: 30,
      y: 30,
      width: 940,
      height: 640,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
  }
  return Buffer.from(await doc.save());
}

test('review mode hides chrome, navigates, lasers, exits', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'review.pdf',
    mimeType: 'application/pdf',
    buffer: await twoPages(),
  });
  await expect(page.locator('.page[data-page="1"] canvas').first()).toBeVisible();
  await expect(page.locator('.toolbar')).toBeVisible();

  await page.keyboard.press('Control+Shift+f');
  await expect(page.locator('.toolbar')).toBeHidden();
  await expect(page.getByRole('complementary', { name: 'Panel' })).toBeHidden();
  const bar = page.getByRole('toolbar', { name: 'Review' });
  await expect(bar).toBeVisible();
  await expect(bar.getByTestId('review-page')).toHaveText('1 / 2');

  await bar.getByRole('button', { name: 'Next page' }).click();
  await expect(bar.getByTestId('review-page')).toHaveText('2 / 2');
  await page.keyboard.press('ArrowLeft');
  await expect(bar.getByTestId('review-page')).toHaveText('1 / 2');

  // Laser: a dot follows the pointer over the viewer only.
  await bar.getByRole('button', { name: 'Laser' }).click();
  const viewer = page.locator('.viewer');
  const box = (await viewer.boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 150);
  const dot = page.getByTestId('laser-dot');
  await expect(dot).toBeVisible();
  const dotBox = (await dot.boundingBox())!;
  expect(Math.abs(dotBox.x + dotBox.width / 2 - (box.x + 200))).toBeLessThan(3);
  await page.keyboard.press('l');
  await expect(dot).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('.toolbar')).toBeVisible();
  await expect(bar).toBeHidden();

  // Menu bar entry.
  await page.getByRole('menubar').getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Review mode' }).click();
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Exit' }).click();
  await expect(bar).toBeHidden();
});
