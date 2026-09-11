/**
 * Cloud (Shift+G) and Highlighter (Shift+H).
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

test('cloud by clicks, highlighter by drag', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'cloud.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const o = { x: box.x + 100, y: box.y + 100 };

  await page.keyboard.press('Shift+G');
  await page.mouse.click(o.x, o.y);
  await page.mouse.click(o.x + 200, o.y);
  await page.mouse.click(o.x + 200, o.y + 120);
  await page.mouse.click(o.x, o.y + 120);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Cloud');
  await expect(hint(page)).toContainText('selected Polygon/PolygonCloud');

  await page.keyboard.press('Shift+H');
  await page.mouse.move(o.x, o.y + 200);
  await page.mouse.down();
  await page.mouse.move(o.x + 150, o.y + 200, { steps: 4 });
  await page.mouse.move(o.x + 300, o.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(status(page)).toHaveText('Highlight');
  await expect(hint(page)).toContainText('selected Ink');

  await page.keyboard.press('Control+Shift+2');
  const list = page.getByTestId('markups-list');
  await expect(list.locator('tbody[data-subject="Cloud"] tr:not(.group)')).toHaveCount(1);
  await expect(list.locator('tbody[data-subject="Highlight"] tr:not(.group)')).toHaveCount(1);

  // A cloud resizes through its vertex handles like any polygon and stays a cloud.
  await list.locator('tbody[data-subject="Cloud"] tr:not(.group)').first().click();
  await page.keyboard.press('Control+Shift+4');
  const panel = page.getByRole('complementary', { name: 'Panel' });
  await expect(panel.getByText('Polygon / PolygonCloud')).toBeVisible();
  await panel.getByLabel('Line width').fill('4');
  await expect(status(page)).toHaveText('Change width');
});
