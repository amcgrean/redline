/**
 * Smoke: the estimator's core loop in a real browser — open a PDF, calibrate, draw a
 * length, and see the caption. This is POC-KICKOFF claim 1, kept alive as a regression test.
 */

import { expect, test } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

/** A blank ARCH D sheet (36 x 24 in) with a border, built in-test so CI needs no fixtures. */
async function blankArchD(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([2592, 1728]);
  page.drawRectangle({
    x: 36,
    y: 36,
    width: 2592 - 72,
    height: 1728 - 72,
    borderColor: rgb(0.2, 0.2, 0.2),
    borderWidth: 2,
  });
  return Buffer.from(await doc.save());
}

test('open a PDF, calibrate, draw a length, save', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Drop a PDF here')).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'blank-archd.pdf',
    mimeType: 'application/pdf',
    buffer: await blankArchD(),
  });

  // The page rendered and tools unlocked.
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await expect(page.getByRole('button', { name: 'Length (M)' })).toBeEnabled();

  // Calibrate: two clicks 200 css px apart, call it 10 ft.
  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.click(box.x + 100, y);
  await page.mouse.click(box.x + 300, y);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder(`24'-0"`).fill('10');
  await dialog.getByRole('button', { name: 'Apply to page' }).click();
  await expect(page.getByText(/scale: 1 in = .* \(calibrated\)/)).toBeVisible();

  // Length over the same span must read 10'-0".
  await page.getByRole('button', { name: 'Length (M)' }).click();
  await page.mouse.click(box.x + 100, y + 40);
  await page.mouse.click(box.x + 300, y + 40);
  await expect(page.locator('.status').filter({ hasText: 'Length' })).toHaveText(`Length 10'-0"`);

  // Save is enabled once the document is dirty.
  await expect(page.getByRole('button', { name: /^Save/ })).toBeEnabled();
});
