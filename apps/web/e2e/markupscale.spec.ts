/**
 * Per-markup scale: one length reads at its own scale, the page's other lengths do not,
 * and "Use page scale" puts it back.
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
const rows = (page: Page) =>
  page.getByTestId('markups-list').locator('tbody[data-subject="Length"] tr:not(.group)');

test('a markup can carry its own scale', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'scale.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const o = { x: box.x + 80, y: box.y + 80 };
  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  await page.mouse.click(o.x, o.y);
  await page.mouse.click(o.x + 200, o.y);
  await page.getByRole('dialog').getByPlaceholder(`24'-0"`).fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply to page' }).click();
  await expect(page.getByText(/\(calibrated\)/)).toBeVisible();

  await page.keyboard.press('m');
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await page.mouse.click(o.x, o.y + 160);
  await page.mouse.click(o.x + 200, o.y + 160);
  await page.keyboard.press('Control+Shift+2');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toContainText(`10'-0"`);

  // Give the first length twice the page's feet-per-inch: it reads 20 ft, the other 10 ft.
  await rows(page).nth(0).click();
  await page.keyboard.press('Control+Shift+4');
  const scale = page.getByTestId('markup-scale');
  await expect(scale).toContainText('Scale: page');
  const input = page.getByLabel('Markup scale feet per inch');
  const perInch = Number(await input.inputValue());
  expect(perInch).toBeGreaterThan(0);
  await input.fill(String(perInch * 2));
  await input.press('Enter');
  await expect(status(page)).toHaveText('Set markup scale');
  await expect(scale).toContainText('Scale: this markup');
  await input.blur();
  await page.keyboard.press('Control+Shift+2');
  await expect(rows(page).nth(0)).toContainText(`20'-0"`);
  await expect(rows(page).nth(1)).toContainText(`10'-0"`);

  // Undo, redo, then back to the page scale through the button.
  await page.keyboard.press('Control+z');
  await expect(rows(page).nth(0)).toContainText(`10'-0"`);
  await page.keyboard.press('Control+y');
  await expect(rows(page).nth(0)).toContainText(`20'-0"`);
  await rows(page).nth(0).click();
  await page.keyboard.press('Control+Shift+4');
  await page.getByRole('button', { name: 'Use page scale' }).click();
  await expect(status(page)).toHaveText('Use page scale');
  await page.keyboard.press('Control+Shift+2');
  await expect(rows(page).nth(0)).toContainText(`10'-0"`);
});
