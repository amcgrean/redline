/**
 * Snapping: Shift constrains a length to the horizontal; a new segment started near an
 * existing endpoint snaps onto it; Alt overrides; the toolbar toggle turns it off.
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
    name: 'snap.pdf',
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

const lengthRows = (page: Page) =>
  page.getByTestId('markups-list').locator('tbody[data-subject="Length"] tr:not(.group)');

test('Shift constrains, endpoints snap, Alt overrides, toggle disables', async ({ page }) => {
  const o = await openCalibrated(page);
  await page.keyboard.press('Control+Shift+2');

  // 1. Shift: 200 px across and 40 px down would be 10'-2 3/8"; constrained it is 10'-0".
  await page.keyboard.press('m');
  await page.mouse.click(o.x, o.y + 100);
  await page.keyboard.down('Shift');
  await page.mouse.move(o.x + 200, o.y + 140);
  await page.mouse.click(o.x + 200, o.y + 140);
  await page.keyboard.up('Shift');
  await expect(lengthRows(page)).toHaveCount(1);
  await expect(lengthRows(page).nth(0)).toContainText(`10'-0"`);

  // 2. Snap: start 4 px past the previous endpoint; the segment begins exactly on it.
  await page.mouse.move(o.x + 204, o.y + 103);
  await page.mouse.click(o.x + 204, o.y + 103);
  await page.mouse.click(o.x + 400, o.y + 100);
  await expect(lengthRows(page)).toHaveCount(2);
  await expect(lengthRows(page).nth(1)).toContainText(`10'-0"`);

  // 3. Alt: the same start is not snapped, so the run is 4 px (2 3/8") shorter.
  await page.keyboard.down('Alt');
  await page.mouse.click(o.x + 404, o.y + 100);
  await page.keyboard.up('Alt');
  await page.mouse.click(o.x + 600, o.y + 100);
  await expect(lengthRows(page)).toHaveCount(3);
  await expect(lengthRows(page).nth(2)).toContainText(`9'-9`);

  // 4. Toggle off: no snapping at all.
  await page.getByRole('button', { name: 'Snap', exact: true }).click();
  await expect(page.locator('.status').last()).toHaveText('Snap off');
  await page.mouse.click(o.x + 604, o.y + 100);
  await page.mouse.click(o.x + 800, o.y + 100);
  await expect(lengthRows(page)).toHaveCount(4);
  await expect(lengthRows(page).nth(3)).toContainText(`9'-9`);
});
