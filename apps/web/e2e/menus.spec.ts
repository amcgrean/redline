/**
 * PLAN §3.11 leftovers: hide/show, z-order, caption toggle, convert rectangle→area and
 * line→length, thumbnail right-click, tool chest right-click.
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

async function openCalibrated(page: Page) {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'menus.pdf',
    mimeType: 'application/pdf',
    buffer: await twoPages(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
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

async function drawRect(page: Page, x: number, y: number, w: number, h: number) {
  await page.keyboard.press('r');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + w, y + h, { steps: 4 });
  await page.mouse.up();
  await expect(status(page)).toHaveText('Rectangle');
}

test('hide, z-order, caption, convert', async ({ page }) => {
  const o = await openCalibrated(page);

  // Two overlapping rectangles; the second paints on top.
  await drawRect(page, o.x, o.y + 100, 200, 100);
  await drawRect(page, o.x + 100, o.y + 150, 200, 100);
  await page.keyboard.press('v');
  await page.mouse.click(o.x + 150, o.y + 200); // overlap → topmost (second) selected
  const secondId = (await hint(page).textContent())!.match(/\/NM (\w+)/)![1];
  await page.mouse.click(o.x + 150, o.y + 200, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Send to back' }).click();
  await expect(status(page)).toHaveText('Send to back');
  await page.mouse.click(o.x + 600, o.y + 600); // deselect
  await page.mouse.click(o.x + 150, o.y + 200);
  const nowTop = (await hint(page).textContent())!.match(/\/NM (\w+)/)![1];
  expect(nowTop).not.toBe(secondId);
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Send to back');

  // Hide the first rectangle: it leaves the canvas but stays listed; View shows it again.
  await page.mouse.click(o.x + 20, o.y + 110, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Hide', exact: true }).click();
  await expect(status(page)).toHaveText('Hid markup');
  await page.keyboard.press('Control+Shift+2');
  await expect(list(page).locator('tr.hidden-row')).toHaveCount(1);
  await page.getByRole('menubar').getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Show hidden markups' }).click();
  await expect(status(page)).toHaveText('Show');
  await expect(list(page).locator('tr.hidden-row')).toHaveCount(0);

  // Convert the first rectangle (200×100 px = 10 ft × 5 ft) to an area.
  await page.mouse.click(o.x + 20, o.y + 110, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Convert to area' }).click();
  await expect(status(page)).toHaveText('Convert to area');
  await expect(list(page).locator('tbody[data-subject="Rectangle"] tr:not(.group)')).toHaveCount(2);
  await expect(list(page).locator('tbody[data-subject="Rectangle"]')).toContainText('50 sf');

  // A plain line converts to a length; its caption can be hidden and shown.
  await page.keyboard.press('l');
  await page.mouse.click(o.x, o.y + 400);
  await page.mouse.click(o.x + 200, o.y + 400);
  await expect(status(page)).toHaveText('Line');
  await page.keyboard.press('v');
  await page.mouse.click(o.x + 100, o.y + 400, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Convert to length' }).click();
  await expect(status(page)).toHaveText('Convert to length');
  await expect(list(page).locator('tbody[data-subject="Line"]')).toContainText(`10'-0"`);
  await page.mouse.click(o.x + 100, o.y + 400, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Hide caption' }).click();
  await expect(status(page)).toHaveText('Hide caption');
  await page.mouse.click(o.x + 100, o.y + 400, { button: 'right' });
  await expect(
    page.getByRole('menu').getByRole('menuitem', { name: 'Show caption' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
});

test('thumbnail and tool chest right-click menus', async ({ page }) => {
  await openCalibrated(page);
  await page.keyboard.press('Control+Shift+3');
  const thumbs = page.locator('.thumbnails .thumb');
  await expect(thumbs).toHaveCount(2);
  await thumbs.nth(1).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Insert blank page after' }).click();
  await expect(thumbs).toHaveCount(3);
  await thumbs.nth(2).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Delete page' }).click();
  await expect(thumbs).toHaveCount(2);

  await page.keyboard.press('Control+Shift+1');
  const chest = page.getByRole('listbox', { name: 'Tool chest' });
  const option = (i: number) => chest.getByRole('option').nth(i);
  await expect(option(0)).toHaveAttribute('aria-label', 'Length');
  await option(0).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Move down' }).click();
  await expect(option(0)).toHaveAttribute('aria-label', 'Polylength');
  await expect(option(1)).toHaveAttribute('aria-label', 'Length');
  await option(1).click({ button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(status(page)).toHaveText('Duplicated "Length"');
  await expect(chest.getByRole('option')).toHaveCount(8);
});
