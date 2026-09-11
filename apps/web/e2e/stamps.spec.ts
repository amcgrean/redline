/**
 * Stamps: place a built-in, custom text, stamp all pages with undo, import a PNG that
 * survives a reload.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

/** 2×2 red PNG. */
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBFBAAAG4RB/9jS8kFAAAAAElFTkSuQmCC',
  'base64',
);

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
const stampRows = (page: Page) =>
  page.getByTestId('markups-list').locator('tbody[data-subject="Stamp"] tr:not(.group)');

test('built-in, custom text, stamp all pages, import', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'stamps.pdf',
    mimeType: 'application/pdf',
    buffer: await twoPages(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  // Built-in DRAFT.
  await page.keyboard.press('Control+Shift+1');
  const stamps = page.getByRole('listbox', { name: 'Stamps' });
  await stamps.getByRole('option', { name: 'DRAFT' }).click();
  await expect(status(page)).toContainText('Stamp: DRAFT');
  await page.mouse.click(box.x + 100, box.y + 100);
  await expect(status(page)).toHaveText('Stamp');
  await page.keyboard.press('Control+Shift+2');
  await expect(stampRows(page)).toHaveCount(1);
  await expect(stampRows(page).nth(0)).toContainText('DRAFT');

  // Custom text.
  await page.keyboard.press('Control+Shift+1');
  await stamps.getByRole('option', { name: 'Custom text' }).click();
  await page.getByLabel('Stamp text').fill('HOLD FOR PRICING');
  await page.mouse.click(box.x + 100, box.y + 300);
  await expect(status(page)).toHaveText('Stamp');
  await page.keyboard.press('Control+Shift+2');
  await expect(stampRows(page)).toHaveCount(2);
  await expect(stampRows(page).nth(1)).toContainText('HOLD FOR PRICING');

  // Stamp all pages at the top-right, then undo.
  await page.keyboard.press('Control+Shift+1');
  await stamps.getByRole('option', { name: 'RECEIVED' }).click();
  await page.getByLabel('Stamp corner').selectOption('top-right');
  await page.getByRole('button', { name: 'Stamp all pages' }).click();
  await expect(status(page)).toHaveText('Stamp 2 pages');
  await page.keyboard.press('Control+Shift+2');
  await expect(stampRows(page)).toHaveCount(4);
  await expect(stampRows(page).filter({ hasText: 'RECEIVED' })).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Stamp 2 pages');
  await expect(stampRows(page)).toHaveCount(2);

  // Import a PNG, place it, and find it again after a reload.
  await page.keyboard.press('Control+Shift+1');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import stamp' }).click();
  await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: RED_PNG });
  await expect(status(page)).toHaveText('Added stamp "logo"');
  await expect(stamps.getByRole('option', { name: 'logo' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.mouse.click(box.x + 400, box.y + 100);
  await expect(status(page)).toHaveText('Stamp');
  await page.keyboard.press('Control+Shift+2');
  await expect(stampRows(page)).toHaveCount(3);
  await expect(stampRows(page).filter({ hasText: 'logo' })).toHaveCount(1);

  await page.reload();
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'stamps.pdf',
    mimeType: 'application/pdf',
    buffer: await twoPages(),
  });
  await expect(page.locator('.page[data-page="1"] canvas').first()).toBeVisible();
  await page.keyboard.press('Control+Shift+1');
  await expect(
    page.getByRole('listbox', { name: 'Stamps' }).getByRole('option', { name: 'logo' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove stamp logo' }).click();
  await expect(
    page.getByRole('listbox', { name: 'Stamps' }).getByRole('option', { name: 'logo' }),
  ).toHaveCount(0);
});
