/**
 * Flatten: a downloaded copy has no annotations but draws them; "Flatten" on a markup
 * bakes it into the open document with page-history undo.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, rgb } from '@cantoo/pdf-lib';

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
const rows = (page: Page) => page.getByTestId('markups-list').locator('tbody tr:not(.group)');

test('flatten copy download and flatten selected with undo', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'flat.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  // Two rectangles.
  for (const y of [100, 300]) {
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 100, box.y + y);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + y + 120, { steps: 4 });
    await page.mouse.up();
    await expect(status(page)).toHaveText('Rectangle');
  }
  await page.keyboard.press('Control+Shift+2');
  await expect(rows(page)).toHaveCount(2);

  // Flatten copy: the download has no annotations and its content draws the forms.
  await page.keyboard.press('Control+Shift+3');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Flatten copy' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('flat.flattened.pdf');
  await expect(status(page)).toContainText('Flattened 2 markups');
  const flat = await PDFDocument.load(readFileSync((await file.path())!));
  const first = flat.getPage(0);
  expect(first.node.Annots()).toBeUndefined();
  const xobjects = first.node.Resources()?.lookup(PDFName.of('XObject'));
  expect(xobjects).toBeDefined();
  // The open document still has both markups.
  await page.keyboard.press('Control+Shift+2');
  await expect(rows(page)).toHaveCount(2);

  // Flatten one markup in place, then undo.
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 200, box.y + 160, { button: 'right' });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Flatten', exact: true }).click();
  await expect(status(page)).toHaveText('Flatten markup');
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Flatten markup');
  await expect(rows(page)).toHaveCount(2);
});
