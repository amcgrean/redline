/**
 * Thumbnails, single-page layout, and view rotation.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

async function threeLandscapePages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) {
    const page = doc.addPage([2592, 1728]);
    page.drawRectangle({
      x: 36,
      y: 36,
      width: 2592 - 72,
      height: 1728 - 72,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
    page.drawText(`Sheet ${i + 1}`, { x: 100, y: 1600, size: 48 });
  }
  return Buffer.from(await doc.save());
}

async function openDoc(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'three.pdf',
    mimeType: 'application/pdf',
    buffer: await threeLandscapePages(),
  });
  await expect(page.locator('canvas').first()).toBeVisible();
}

test('thumbnails list every page and navigate', async ({ page }) => {
  await openDoc(page);
  await page.getByRole('button', { name: 'Toggle thumbnails' }).click();
  const thumbs = page.getByLabel('Pages').getByRole('button');
  await expect(thumbs).toHaveCount(3);
  await expect(thumbs.nth(0)).toHaveAttribute('aria-current', 'page');
  // Thumbnails render lazily through pdf.js.
  await expect(page.getByLabel('Pages').locator('canvas').first()).toBeVisible();

  await thumbs.nth(2).click();
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('3');
  await expect(thumbs.nth(2)).toHaveAttribute('aria-current', 'page');
});

test('single-page layout shows one page at a time', async ({ page }) => {
  await openDoc(page);
  await expect(page.locator('.page')).toHaveCount(3);

  await page.getByLabel('Page layout').selectOption('single');
  await expect(page.locator('.page')).toHaveCount(1);
  await expect(page.locator('.page')).toHaveAttribute('data-page', '1');

  await page.keyboard.press('PageDown');
  await expect(page.locator('.page')).toHaveAttribute('data-page', '2');
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('2');

  await page.getByLabel('Page layout').selectOption('continuous');
  await expect(page.locator('.page')).toHaveCount(3);
});

test('rotating the view swaps the page aspect and keeps markups aligned', async ({ page }) => {
  await openDoc(page);
  const first = page.locator('.page[data-page="1"]');
  const before = (await first.boundingBox())!;
  expect(before.width).toBeGreaterThan(before.height);

  await page.getByRole('button', { name: 'Rotate view right' }).click();
  await expect
    .poll(async () => {
      const box = (await first.boundingBox())!;
      return box.height > box.width;
    })
    .toBe(true);

  // A length drawn on the rotated view still measures the same span.
  const canvas = first.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  await page.mouse.click(x, box.y + 100);
  await page.mouse.click(x, box.y + 300);
  await page.getByRole('dialog').getByPlaceholder(`24'-0"`).fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply to page' }).click();
  await page.getByRole('button', { name: 'Length (M)' }).click();
  await page.mouse.click(x + 40, box.y + 100);
  await page.mouse.click(x + 40, box.y + 300);
  await expect(page.locator('.status').last()).toHaveText(`Length 10'-0"`);

  await page.getByRole('button', { name: 'Rotate view left' }).click();
  await expect
    .poll(async () => {
      const b = (await first.boundingBox())!;
      return b.width > b.height;
    })
    .toBe(true);
});
