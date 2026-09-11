/**
 * Group / Ungroup: a group selects, moves and deletes as one; undo restores it.
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
const rows = (page: Page) => page.getByTestId('markups-list').locator('tbody tr:not(.group)');

async function drawRect(page: Page, x: number, y: number) {
  await page.keyboard.press('r');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 80, { steps: 4 });
  await page.mouse.up();
  await expect(status(page)).toHaveText('Rectangle');
}

test('group selects and moves together; ungroup and undo', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'group.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const o = { x: box.x + 100, y: box.y + 100 };
  await drawRect(page, o.x, o.y);
  await drawRect(page, o.x + 300, o.y);
  await drawRect(page, o.x + 600, o.y); // stays outside the group

  await page.keyboard.press('v');
  await page.mouse.click(o.x + 60, o.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(o.x + 360, o.y + 40);
  await page.keyboard.up('Shift');
  await expect(hint(page)).toContainText('2 selected');
  await page.keyboard.press('Control+g');
  await expect(status(page)).toHaveText('Group 2 markups');

  // Clicking one member selects both; the third stays out.
  await page.keyboard.press('Escape'); // deselect
  await page.mouse.click(o.x + 60, o.y + 40);
  await expect(hint(page)).toContainText('2 selected');
  await page.keyboard.press('Control+Shift+2');
  await expect(rows(page).filter({ hasText: '⧉' })).toHaveCount(1); // the child is marked

  // Dragging one member moves both: a marquee over the old spot of the second finds nothing.
  await page.mouse.move(o.x + 60, o.y + 40);
  await page.mouse.down();
  await page.mouse.move(o.x + 60, o.y + 240, { steps: 6 });
  await page.mouse.up();
  await expect(status(page)).toHaveText('Move 2 markups');
  await page.keyboard.press('Escape');
  await page.mouse.click(o.x + 360, o.y + 40); // old place of the second rectangle
  await expect(hint(page)).not.toContainText('selected');
  await page.mouse.click(o.x + 360, o.y + 240); // its new place
  await expect(hint(page)).toContainText('2 selected');

  // Ungroup via the menu, then undo the ungroup.
  await page.mouse.click(o.x + 360, o.y + 240, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Ungroup' }).click();
  await expect(status(page)).toHaveText('Ungroup');
  await page.keyboard.press('Escape');
  await page.mouse.click(o.x + 360, o.y + 240);
  await expect(hint(page)).toContainText('selected Square');
  await expect(hint(page)).not.toContainText('2 selected');
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Ungroup');
  await page.keyboard.press('Escape');
  await page.mouse.click(o.x + 360, o.y + 240);
  await expect(hint(page)).toContainText('2 selected');

  // Delete removes the whole group; the third rectangle remains.
  await page.keyboard.press('Delete');
  await expect(rows(page)).toHaveCount(1);
});
