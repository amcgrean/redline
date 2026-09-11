/**
 * Pages panel: select, rotate, delete with undo, move to first, drag to reorder, insert
 * blank, extract to a new file. Markups ride along through every full rewrite.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

/** Three pages with distinct aspect ratios so order and rotation are visible. */
async function threePages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const [w, h] of [
    [1000, 500],
    [500, 1000],
    [800, 800],
  ] as const) {
    const page = doc.addPage([w, h]);
    page.drawRectangle({
      x: 20,
      y: 20,
      width: w - 40,
      height: h - 40,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
  }
  return Buffer.from(await doc.save());
}

const thumbs = (page: Page) => page.locator('.thumbnails .thumb');
const thumbHeight = async (page: Page, i: number): Promise<number> =>
  (await thumbs(page).nth(i).locator('.thumb-canvas').boundingBox())!.height;
const pageCount = (page: Page) => page.locator('.page-indicator');

// Tall enough that the thumbnail list never scrolls: drag-and-drop coordinates stay put.
test.use({ viewport: { width: 1280, height: 1100 } });

test('rotate, delete + undo, move, drag, insert, extract', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'pages.pdf',
    mimeType: 'application/pdf',
    buffer: await threePages(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();

  // A note on page 1 so we can prove markups survive the rewrites.
  const box = (await canvas.boundingBox())!;
  await page.keyboard.press('n');
  await page.mouse.click(box.x + 60, box.y + 60);
  await page.getByLabel('Markup text').fill('keep me');
  await page.keyboard.press('Enter');
  await expect(page.locator('.status').last()).toHaveText('Note');

  await page.keyboard.press('Control+Shift+3');
  await expect(thumbs(page)).toHaveCount(3);
  // Aspects: 0.5, 2, 1 → heights 66, 264, 132 at a 132 px width.
  expect(await thumbHeight(page, 0)).toBe(66);
  expect(await thumbHeight(page, 1)).toBe(264);

  // Rotate page 1: it becomes portrait.
  await thumbs(page).nth(0).click();
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await expect(page.locator('.status').last()).toHaveText('Rotate page');
  await expect.poll(() => thumbHeight(page, 0)).toBe(264);

  // Delete page 2, then undo.
  await thumbs(page).nth(1).click();
  await page.getByRole('button', { name: 'Delete pages' }).click();
  await expect(page.locator('.status').last()).toHaveText('Delete page');
  await expect(thumbs(page)).toHaveCount(2);
  await expect(pageCount(page)).toContainText('of 2');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.status').last()).toHaveText('Undo Delete page');
  await expect(thumbs(page)).toHaveCount(3);
  expect(await thumbHeight(page, 1)).toBe(264);

  // Move page 3 (square) to the front.
  await thumbs(page).nth(2).click();
  await page.getByRole('button', { name: 'Move to first' }).click();
  await expect(page.locator('.status').last()).toHaveText('Move page');
  await expect.poll(() => thumbHeight(page, 0)).toBe(132);
  await expect(thumbs(page).nth(0)).toHaveAttribute('aria-pressed', 'true');

  // Drag the square page (now first) after the last page. The HTML5 drag is driven with
  // dispatched events (a DataTransfer and a clientY in the lower half of the target) so
  // the test does not depend on how the runner's pointer emulates native drag-and-drop.
  const last = thumbs(page).nth(2);
  const lastBox = (await last.boundingBox())!;
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await thumbs(page).nth(0).dispatchEvent('dragstart', { dataTransfer });
  await last.dispatchEvent('dragover', {
    dataTransfer,
    clientX: lastBox.x + lastBox.width / 2,
    clientY: lastBox.y + lastBox.height - 3,
  });
  await last.dispatchEvent('drop', {
    dataTransfer,
    clientX: lastBox.x + lastBox.width / 2,
    clientY: lastBox.y + lastBox.height - 3,
  });
  await expect(page.locator('.status').last()).toHaveText('Reorder page');
  await expect.poll(() => thumbHeight(page, 2)).toBe(132);
  await expect.poll(() => thumbHeight(page, 0)).toBe(264);

  // Insert a blank page after page 1 (same size as the current page).
  await thumbs(page).nth(0).click();
  await page.getByRole('button', { name: 'Insert blank page' }).click();
  await expect(thumbs(page)).toHaveCount(4);
  await expect(pageCount(page)).toContainText('of 4');

  // The note survived every rewrite.
  await page.keyboard.press('Control+Shift+2');
  await expect(page.getByTestId('markups-list')).toContainText('keep me');
  await page.keyboard.press('Control+Shift+3');

  // Extract pages 1-2 to a new file.
  await thumbs(page).nth(0).click();
  await thumbs(page)
    .nth(1)
    .click({ modifiers: ['Control'] });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('pages.p1-2.pdf');
  const extracted = await PDFDocument.load(readFileSync((await file.path())!));
  expect(extracted.getPageCount()).toBe(2);
  // The extracted first page carries the rotated original page 1 with its note.
  expect(extracted.getPage(0).getRotation().angle).toBe(90);
  expect(extracted.getPage(0).node.Annots()?.size()).toBe(1);
});
