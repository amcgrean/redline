/**
 * Compress — Reduce images: a page carrying a large lossless RGB image gets re-encoded as
 * JPEG at the target dpi and the file shrinks; markups survive; undo restores.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';

/** Letter page with a 2200×1700 raw RGB noise image drawn full-page (≈ 200 dpi, Flate). */
async function scanLike(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const width = 2200;
  const height = 1700;
  const rgb = new Uint8Array(width * height * 3);
  // Real randomness so Flate cannot shrink it: a worst case for JPEG too.
  for (let offset = 0; offset < rgb.length; offset += 65_536) {
    crypto.getRandomValues(rgb.subarray(offset, Math.min(rgb.length, offset + 65_536)));
  }
  const image = doc.context.flateStream(rgb, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
  });
  const ref = doc.context.register(image);
  const page = doc.addPage([792, 612]);
  const name = page.node.newXObject('Scan', ref);
  const content = doc.context.stream(`q 792 0 0 612 0 0 cm /${name.decodeText()} Do Q`);
  page.node.set(PDFName.of('Contents'), doc.context.register(content));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

const status = (page: Page) => page.locator('.status').last();
const rows = (page: Page) => page.getByTestId('markups-list').locator('tbody tr:not(.group)');

test('reduce images shrinks a scan-like page and keeps markups', async ({ page }) => {
  const input = await scanLike();
  expect(input.length).toBeGreaterThan(5_000_000);
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: input,
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160, { steps: 4 });
  await page.mouse.up();
  await expect(status(page)).toHaveText('Rectangle');

  await page.keyboard.press('Control+Shift+3');
  await page.getByRole('button', { name: 'Compress' }).click();
  const dialog = page.getByRole('dialog', { name: 'Compress' });
  await dialog.getByLabel('Reduce images').check();
  await dialog.getByLabel('Image resolution').selectOption('150');
  await dialog.getByLabel('Image quality').selectOption('0.6');
  await dialog.getByRole('button', { name: 'Preview size' }).click();
  const result = dialog.getByTestId('compress-result');
  await expect(result).toContainText('smaller', { timeout: 120_000 });
  await expect(result).toContainText('1 image re-encoded');
  const text = (await result.textContent()) ?? '';
  const pct = Number(/\((\d+)% smaller\)/.exec(text)?.[1] ?? '0');
  expect(pct).toBeGreaterThan(50);

  await dialog.getByRole('button', { name: 'Use compressed' }).click();
  await expect(status(page)).toContainText('Compressed:');
  await page.keyboard.press('Control+Shift+2');
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Compress');
  await expect(rows(page)).toHaveCount(1);
  void PDFRawStream;
});
