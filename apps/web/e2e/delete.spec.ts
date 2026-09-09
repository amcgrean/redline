/**
 * Delete with undo: Delete key, Properties button, and a Revu-authored-style markup that
 * came from the file (deleting it must be undoable too).
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFString, rgb } from '@cantoo/pdf-lib';

/** A sheet that already carries one Square annotation, as a Revu-authored file would. */
async function sheetWithSquare(): Promise<Buffer> {
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
  const ctx = doc.context;
  const annot = ctx.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [400, 400, 700, 600],
    C: [1, 0, 0],
    CA: 1,
    F: 4,
    NM: PDFString.of('SQUAREFROMFILEAB'),
    Subj: PDFString.of('Rectangle'),
    T: PDFString.of('mhackett'),
    Contents: PDFString.of('from the file'),
  });
  const ref = ctx.register(annot);
  page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  return Buffer.from(await doc.save());
}

async function openDoc(page: Page): Promise<{ x: number; y: number }> {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'delete.pdf',
    mimeType: 'application/pdf',
    buffer: await sheetWithSquare(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  return { x: box.x + 80, y: box.y + 80 };
}

const status = (page: Page) => page.locator('.status').last();

test('Delete key removes the selected measurement; undo brings it back', async ({ page }) => {
  const o = await openDoc(page);
  await page.getByRole('button', { name: `Preset 1/8" = 1'-0"` }).click();
  await page.keyboard.press('m');
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await expect(status(page)).toHaveText(/^Length /);
  await expect(page.getByText(/selected Line\/LineDimension/)).toBeVisible();

  await page.keyboard.press('Delete');
  await expect(status(page)).toHaveText('Delete');
  await page.keyboard.press('Control+Shift+2');
  await expect(
    page.getByTestId('markups-list').locator('tbody[data-subject="Length"]'),
  ).toHaveCount(0);

  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Delete');
  await expect(
    page.getByTestId('markups-list').locator('tbody[data-subject="Length"] tr'),
  ).toHaveCount(2);
});

test('a markup from the file can be deleted from Properties and restored', async ({ page }) => {
  await openDoc(page);
  await page.keyboard.press('Control+Shift+2');
  const list = page.getByTestId('markups-list');
  await list.locator('tbody[data-subject="Rectangle"] tr:not(.group)').first().click();
  await page.keyboard.press('Control+Shift+4');
  await expect(
    page.getByRole('complementary', { name: 'Panel' }).getByText('from the file'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Delete markup' }).click();
  await expect(status(page)).toHaveText('Delete');
  await page.keyboard.press('Control+Shift+2');
  await expect(page.getByTestId('markups-list')).toHaveCount(0); // "No markups yet"
  await expect(page.getByText('No markups yet.')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(
    page.getByTestId('markups-list').locator('tbody[data-subject="Rectangle"] tr'),
  ).toHaveCount(2);
});
