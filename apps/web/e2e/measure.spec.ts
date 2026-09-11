/**
 * The estimator measurement family: polylength, perimeter, rectangle area.
 * Calibration: 200 css px = 10 ft, so every 20 px is 1 ft.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

async function sheet(): Promise<Buffer> {
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

async function openCalibrated(page: Page): Promise<{ x: number; y: number }> {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'measure.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + 80, y: box.y + 80 };
  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  await page.mouse.click(origin.x, origin.y);
  await page.mouse.click(origin.x + 200, origin.y);
  await page.getByRole('dialog').getByPlaceholder(`24'-0"`).fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply to page' }).click();
  await expect(page.getByText(/\(calibrated\)/)).toBeVisible();
  return origin;
}

const status = (page: Page) => page.locator('.status').last();

test('polylength: three clicks, Enter to finish, 30 ft', async ({ page }) => {
  const o = await openCalibrated(page);
  await page.keyboard.press('Shift+M');
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100); // 10 ft
  await page.mouse.click(o.x + 200, o.y + 300); // + 10 ft
  await page.mouse.click(o.x + 400, o.y + 300); // + 10 ft
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(`Polylength 30'-0"`);
  await expect(page.getByText(/selected PolyLine\/PolyLineDimension/)).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Polylength');
});

test('perimeter: click the first corner again to close, 40 ft', async ({ page }) => {
  const o = await openCalibrated(page);
  await page.getByRole('button', { name: 'Perimeter (Shift+A)' }).click();
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 300);
  await page.mouse.click(o.x, o.y + 300);
  await page.mouse.click(o.x, o.y + 100); // back to the start closes the loop
  await expect(status(page)).toHaveText(`Perimeter 40'-0"`);
});

test('rectangle area: two corners, 100 sf', async ({ page }) => {
  const o = await openCalibrated(page);
  await page.getByRole('button', { name: 'Rect Area', exact: true }).click();
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 300);
  await expect(status(page)).toHaveText('Area 100 sf');
  await expect(page.getByText(/selected Polygon\/PolygonDimension/)).toBeVisible();
});
