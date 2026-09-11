/**
 * Multi-select: Shift-click, marquee, Ctrl+A, group move, bulk delete with one undo.
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

const status = (page: Page) => page.locator('.status').last();
const hint = (page: Page) => page.locator('.hint');

async function openWithThreeLengths(page: Page): Promise<{ x: number; y: number }> {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'multi.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const o = { x: box.x + 120, y: box.y + 120 };
  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  await page.mouse.click(o.x, o.y);
  await page.mouse.click(o.x + 200, o.y);
  await page.getByRole('dialog').getByPlaceholder(`24'-0"`).fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply to page' }).click();
  await expect(page.getByText(/\(calibrated\)/)).toBeVisible();
  await page.keyboard.press('m');
  for (const dy of [60, 120, 180]) {
    await page.mouse.click(o.x, o.y + dy);
    await page.mouse.click(o.x + 200, o.y + dy);
    await expect(status(page)).toHaveText(`Length 10'-0"`);
  }
  await page.keyboard.press('v');
  return o;
}

test('shift-click, marquee, Ctrl+A, group move and bulk delete', async ({ page }) => {
  const o = await openWithThreeLengths(page);

  // Click the first line, shift-click the second.
  await page.mouse.click(o.x + 100, o.y + 60);
  await expect(hint(page)).toContainText('selected Line/LineDimension');
  await page.keyboard.down('Shift');
  await page.mouse.click(o.x + 100, o.y + 120);
  await page.keyboard.up('Shift');
  await expect(hint(page)).toContainText('2 selected');

  // Group move: drag one of the two by 40 px; both move as one command.
  await page.mouse.move(o.x + 100, o.y + 120);
  await page.mouse.down();
  await page.mouse.move(o.x + 120, o.y + 140, { steps: 3 });
  await page.mouse.move(o.x + 140, o.y + 160, { steps: 3 });
  await page.mouse.up();
  await expect(status(page)).toHaveText('Move 2 markups');
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Move 2 markups');

  // Escape clears; a marquee around all three selects three.
  await page.keyboard.press('Escape');
  await expect(hint(page)).not.toContainText('selected');
  await page.mouse.move(o.x - 40, o.y + 30);
  await page.mouse.down();
  await page.mouse.move(o.x + 100, o.y + 120, { steps: 4 });
  await page.mouse.move(o.x + 240, o.y + 210, { steps: 4 });
  await page.mouse.up();
  await expect(hint(page)).toContainText('3 selected');

  // Bulk delete, one undo.
  await page.keyboard.press('Delete');
  await expect(status(page)).toHaveText('Delete 3 markups');
  await page.keyboard.press('Control+Shift+2');
  await expect(page.getByText('No markups yet.')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(
    page.getByTestId('markups-list').locator('tbody[data-subject="Length"] tr:not(.group)'),
  ).toHaveCount(3);

  // Ctrl+A on the page.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await expect(status(page)).toHaveText('3 selected on page 1');
  await expect(hint(page)).toContainText('3 selected');

  // Bulk subject edit from Properties.
  await page.keyboard.press('Control+Shift+4');
  const panel = page.getByRole('complementary', { name: 'Panel' });
  await expect(
    panel.getByText('3 selected — edits and Delete apply to all of them.'),
  ).toBeVisible();
  await panel.getByLabel('Subject').fill('Base');
  await panel.getByLabel('Subject').press('Enter');
  await page.keyboard.press('Control+Shift+2');
  await expect(
    page.getByTestId('markups-list').locator('tbody[data-subject="Base"] tr:not(.group)'),
  ).toHaveCount(3);
});
