/**
 * Vertex editing: drag an endpoint handle of a selected length; the value updates; undo.
 * Calibration: 200 css px = 10 ft.
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
    name: 'vertex.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const o = { x: box.x + 80, y: box.y + 80 };
  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  await page.mouse.click(o.x, o.y);
  await page.mouse.click(o.x + 200, o.y);
  await page.getByRole('dialog').getByPlaceholder(`24'-0"`).fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply to page' }).click();
  await expect(page.getByText(/\(calibrated\)/)).toBeVisible();
  return o;
}

const status = (page: Page) => page.locator('.status').last();

test('drag a length endpoint: 10 ft becomes 20 ft; undo restores', async ({ page }) => {
  const o = await openCalibrated(page);
  await page.keyboard.press('m');
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await expect(status(page)).toHaveText(`Length 10'-0"`);

  // The new length is selected and in Select mode its handles show. Drag the far endpoint
  // 200 px further right.
  await page.keyboard.press('v');
  await page.mouse.click(o.x + 100, o.y + 100); // click the line to select it
  await expect(page.getByText(/selected Line\/LineDimension/)).toBeVisible();
  await page.mouse.move(o.x + 200, o.y + 100);
  await page.mouse.down();
  await page.mouse.move(o.x + 300, o.y + 100, { steps: 4 });
  await page.mouse.move(o.x + 400, o.y + 100, { steps: 4 });
  await page.mouse.up();
  await expect(status(page)).toHaveText(`Edit shape 20'-0"`);
  await expect(page.getByText(/20'-0"/).first()).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Edit shape');
  await page.keyboard.press('Control+Shift+2');
  await expect(
    page
      .getByTestId('markups-list')
      .locator('tbody[data-subject="Length"] tr:not(.group) td')
      .nth(3),
  ).toHaveText(`10'-0"`);
});
