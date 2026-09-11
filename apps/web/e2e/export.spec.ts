/**
 * Markups List CSV export: header, one row per markup, a subtotal per subject.
 */

import { readFileSync } from 'node:fs';
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
    name: 'export.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const o = { x: box.x + 80, y: box.y + 80 };
  // 200 px = 10 ft.
  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  await page.mouse.click(o.x, o.y);
  await page.mouse.click(o.x + 200, o.y);
  await page.getByRole('dialog').getByPlaceholder(`24'-0"`).fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply to page' }).click();
  await expect(page.getByText(/\(calibrated\)/)).toBeVisible();
  return o;
}

test('exports a CSV with rows and subtotals', async ({ page }) => {
  const o = await openCalibrated(page);
  await page.keyboard.press('m');
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await page.mouse.click(o.x, o.y + 160);
  await page.mouse.click(o.x + 400, o.y + 160);
  await page.keyboard.press('c');
  await page.mouse.click(o.x, o.y + 300);
  await page.mouse.click(o.x + 50, o.y + 300);
  await page.mouse.click(o.x + 100, o.y + 300);

  await page.keyboard.press('Control+Shift+2');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('export.markups.csv');
  const text = readFileSync((await file.path())!, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.trim().split(/\r?\n/);
  // The default chest's Wall LF tool contributes two formula columns after Count.
  expect(lines[0]).toBe(
    'Subject,Page,Type,Value,Length (ft),Area (sf),Count,Wall area (sf),Studs,Author,Modified,ID',
  );
  // Count group: 3 rows + subtotal 3; Length: 2 rows (10 ft, 20 ft) + subtotal 30.
  expect(lines.filter((l) => l.startsWith('Count,1,Count,1,,,1,,,'))).toHaveLength(3);
  expect(lines).toContain('Count,,Subtotal,,,,3,,,,,');
  expect(lines.filter((l) => l.startsWith('Length,1,Length,'))).toHaveLength(2);
  expect(lines).toContain('Length,,Subtotal,,30,,,,,,,');
});
