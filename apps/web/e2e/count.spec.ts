/**
 * Count tool: each click is a symbol; the status reports the group total; undo removes
 * the last symbol; re-selecting the tool starts a new group.
 */

import { expect, test } from '@playwright/test';
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

test('count three items, undo one, start a new group', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'count.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const status = page.locator('.status').last();

  // Counting needs no calibration.
  await page.keyboard.press('c');
  await page.mouse.click(box.x + 100, box.y + 100);
  await expect(status).toHaveText('Count 1');
  await page.mouse.click(box.x + 200, box.y + 100);
  await page.mouse.click(box.x + 300, box.y + 100);
  await expect(status).toHaveText('Count 3');
  await expect(page.getByText(/selected Circle “Count”/)).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(status).toHaveText('Undo Count');
  await page.mouse.click(box.x + 400, box.y + 100);
  await expect(status).toHaveText('Count 3');

  // A fresh activation of the tool starts a new group.
  await page.getByRole('button', { name: 'Count (C)' }).click();
  await page.mouse.click(box.x + 100, box.y + 300);
  await expect(status).toHaveText('Count 1');
});
