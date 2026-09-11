/**
 * Sales/review shapes: rectangle and ellipse by drag, line and arrow by two clicks, polygon
 * by clicks, pen by drag. None needs a page scale.
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

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

test('draw every shape kind without a scale', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'shapes.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const o = { x: box.x + 80, y: box.y + 80 };

  await page.keyboard.press('r');
  await drag(page, [o.x, o.y], [o.x + 150, o.y + 100]);
  await expect(status(page)).toHaveText('Rectangle');
  await expect(hint(page)).toContainText('selected Square');

  await page.keyboard.press('e');
  await drag(page, [o.x + 200, o.y], [o.x + 350, o.y + 100]);
  await expect(status(page)).toHaveText('Ellipse');
  await expect(hint(page)).toContainText('selected Circle');

  await page.keyboard.press('l');
  await page.mouse.click(o.x, o.y + 150);
  await page.mouse.click(o.x + 150, o.y + 150);
  await expect(status(page)).toHaveText('Line');
  await expect(hint(page)).toContainText('selected Line');

  await page.keyboard.press('Shift+L');
  await page.mouse.click(o.x + 200, o.y + 150);
  await page.mouse.click(o.x + 350, o.y + 150);
  await expect(status(page)).toHaveText('Arrow');
  await expect(hint(page)).toContainText('selected Line/LineArrow');

  await page.keyboard.press('g');
  await page.mouse.click(o.x, o.y + 200);
  await page.mouse.click(o.x + 150, o.y + 200);
  await page.mouse.click(o.x + 80, o.y + 300);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Polygon');
  await expect(hint(page)).toContainText('selected Polygon');

  await page.keyboard.press('p');
  await drag(page, [o.x + 200, o.y + 220], [o.x + 350, o.y + 300]);
  await expect(status(page)).toHaveText('Pen');
  await expect(hint(page)).toContainText('selected Ink');

  await page.keyboard.press('Control+Shift+2');
  const list = page.getByTestId('markups-list');
  for (const subject of ['Rectangle', 'Ellipse', 'Line', 'Arrow', 'Polygon', 'Pen']) {
    await expect(list.locator(`tbody[data-subject="${subject}"] tr:not(.group)`)).toHaveCount(1);
  }

  // Undo removes the pen stroke; restyle a rectangle from Properties.
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Pen');
  await list.locator('tbody[data-subject="Rectangle"] tr:not(.group)').first().click();
  await page.keyboard.press('Control+Shift+4');
  const panel = page.getByRole('complementary', { name: 'Panel' });
  await panel.getByLabel('Line width').fill('5');
  await expect(status(page)).toHaveText('Change width');
});
