/**
 * Compress: Optimize runs qpdf in a worker, previews the size, and "Use optimized"
 * swaps the document while keeping every markup.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

async function sheet(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([2592, 1728]);
  for (let i = 0; i < 40; i += 1) {
    page.drawRectangle({
      x: 40 + i * 60,
      y: 40 + i * 30,
      width: 400,
      height: 300,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

const status = (page: Page) => page.locator('.status').last();
const rows = (page: Page) => page.getByTestId('markups-list').locator('tbody tr:not(.group)');

test('optimize previews savings and replaces the document', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 220, { steps: 4 });
  await page.mouse.up();
  await expect(status(page)).toHaveText('Rectangle');

  await page.keyboard.press('Control+Shift+3');
  await page.getByRole('button', { name: 'Compress' }).click();
  const dialog = page.getByRole('dialog', { name: 'Compress' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('compress-result')).toContainText(/smaller|larger/, {
    timeout: 60_000,
  });
  await dialog.getByRole('button', { name: 'Use optimized' }).click();
  await expect(status(page)).toContainText('Optimized:');
  await page.keyboard.press('Control+Shift+2');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('.page-indicator')).toContainText('of 1');
  // Undo through the page history brings the pre-optimize bytes back.
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Optimize');
  await expect(rows(page)).toHaveCount(1);
});
