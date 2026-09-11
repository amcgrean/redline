/**
 * Right-click menu, duplicate, copy/paste across pages, lock, shortcut help.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

async function twoPages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i += 1) {
    const page = doc.addPage([2592, 1728]);
    page.drawRectangle({
      x: 36,
      y: 36,
      width: 2592 - 72,
      height: 1728 - 72,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
  }
  return Buffer.from(await doc.save());
}

const status = (page: Page) => page.locator('.status').last();
const hint = (page: Page) => page.locator('.hint');
const list = (page: Page) => page.getByTestId('markups-list');

test('menu on a markup: duplicate, lock; menu on the page: paste; help overlay', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'menu.pdf',
    mimeType: 'application/pdf',
    buffer: await twoPages(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const o = { x: box.x + 120, y: box.y + 120 };

  // A rectangle to work with.
  await page.keyboard.press('r');
  await page.mouse.move(o.x, o.y);
  await page.mouse.down();
  await page.mouse.move(o.x + 150, o.y + 100, { steps: 4 });
  await page.mouse.up();
  await expect(status(page)).toHaveText('Rectangle');
  await page.keyboard.press('v');

  // Right-click it: Duplicate.
  await page.mouse.click(o.x + 75, o.y + 50, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(status(page)).toHaveText('Duplicate');
  await page.keyboard.press('Control+Shift+2');
  await expect(list(page).locator('tbody[data-subject="Rectangle"] tr:not(.group)')).toHaveCount(2);

  // Ctrl+D duplicates again; Ctrl+Z removes it.
  await page.keyboard.press('Control+d');
  await expect(list(page).locator('tbody[data-subject="Rectangle"] tr:not(.group)')).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(list(page).locator('tbody[data-subject="Rectangle"] tr:not(.group)')).toHaveCount(2);

  // Lock the original through the menu: Delete is then refused.
  await page.mouse.click(o.x + 75, o.y + 50, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Lock' }).click();
  await expect(status(page)).toHaveText('Lock');
  await page.mouse.click(o.x + 75, o.y + 50, { button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Unlock' }).click();
  await expect(status(page)).toHaveText('Unlock');

  // Copy, go to page 2, paste from the page menu.
  await page.mouse.click(o.x + 75, o.y + 50);
  await expect(hint(page)).toContainText('selected Square');
  await page.keyboard.press('Control+c');
  await expect(status(page)).toHaveText('Copied 1');
  await page.keyboard.press('PageDown');
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('2');
  const page2 = page.locator('.page[data-page="2"] canvas').first();
  const b2 = (await page2.boundingBox())!;
  await page.mouse.click(b2.x + 400, b2.y + 300, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Paste' }).click();
  await expect(status(page)).toHaveText('Paste');
  const rows = list(page).locator('tbody[data-subject="Rectangle"] tr:not(.group)');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: /^Rectangle2/ })).toHaveCount(1);

  // Help overlay.
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
});
