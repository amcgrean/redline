/**
 * The right-hand panel: Measure (presets, scope), Markups (subtotals, select), Pages,
 * Properties.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

async function threePages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const sizes: [number, number][] = [
    [2592, 1728],
    [2592, 1728],
    [1728, 2592], // portrait: not "like" the others
  ];
  for (const [w, h] of sizes) {
    const page = doc.addPage([w, h]);
    page.drawRectangle({
      x: 36,
      y: 36,
      width: w - 72,
      height: h - 72,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
  }
  return Buffer.from(await doc.save());
}

async function openDoc(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'panel.pdf',
    mimeType: 'application/pdf',
    buffer: await threePages(),
  });
  await expect(page.locator('canvas').first()).toBeVisible();
}

test('Measure tab: presets with scope, custom ratio', async ({ page }) => {
  await openDoc(page);
  const panel = page.getByRole('complementary', { name: 'Panel' });
  await page.keyboard.press('Control+Shift+5');
  await expect(panel.getByRole('tab', { name: 'Measure' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('scale-current')).toContainText('Not set');

  // Pages like this one: pages 1 and 2 (landscape), not page 3.
  await panel.getByLabel('Pages like this one').check();
  await page.keyboard.press('Control+Shift+5');
  await panel.getByRole('button', { name: `Preset 1/8" = 1'-0"` }).click();
  await expect(page.getByTestId('scale-current')).toContainText(`1/8" = 1'-0"`);
  await expect(panel.getByText('2 of 3 pages have a scale')).toBeVisible();
  await expect(page.locator('.status').last()).toHaveText('Calibrate 2 pages');

  // One undo restores both.
  await page.keyboard.press('Control+z');
  await expect(panel.getByText('0 of 3 pages have a scale')).toBeVisible();

  // All pages, custom ratio.
  await panel.getByLabel('All pages').check();
  await panel.getByLabel('Custom feet per inch').fill('4');
  await panel.getByLabel('Custom feet per inch').press('Enter');
  await expect(page.getByTestId('scale-current')).toContainText(`1/4" = 1'-0"`);
  await expect(panel.getByText('3 of 3 pages have a scale')).toBeVisible();
});

test('Markups tab lists measurements with subtotals and selects on click', async ({ page }) => {
  await openDoc(page);
  const panel = page.getByRole('complementary', { name: 'Panel' });
  await page.keyboard.press('Control+Shift+5');
  await panel.getByRole('button', { name: `Preset 1/8" = 1'-0"` }).click();

  // Two lengths of the same subject: 720 px... use the calibrated page: 1/8" = 1' means
  // 9 pt per ft; at the fit zoom we just check that two rows and a subtotal appear.
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const y = box.y + 120;
  await page.keyboard.press('m');
  await page.mouse.click(box.x + 100, y);
  await page.mouse.click(box.x + 300, y);
  await page.mouse.click(box.x + 100, y + 60);
  await page.mouse.click(box.x + 300, y + 60);

  await page.keyboard.press('Control+Shift+2');
  const list = page.getByTestId('markups-list');
  await expect(list.locator('tbody[data-subject="Length"] tr')).toHaveCount(3); // group + 2
  const subtotal = list.locator('tbody[data-subject="Length"] [data-testid="subtotal"]');
  await expect(subtotal).toHaveText(/'-/);
  const rowValue = await list
    .locator('tbody[data-subject="Length"] tr:not(.group) td')
    .nth(3)
    .textContent();
  expect(rowValue).toMatch(/'-/);

  // Click the first row: it becomes selected in the viewer and in the list.
  await list.locator('tbody[data-subject="Length"] tr:not(.group)').first().click();
  await expect(list.locator('tr.selected')).toHaveCount(1);
  await expect(page.getByText(/selected Line\/LineDimension/)).toBeVisible();

  // Properties tab shows it.
  await page.keyboard.press('Control+Shift+4');
  await expect(panel.getByText('Line / LineDimension')).toBeVisible();
});

test('Pages tab hosts the thumbnails; the panel collapses to a rail', async ({ page }) => {
  await openDoc(page);
  const panel = page.getByRole('complementary', { name: 'Panel' });
  await page.getByRole('button', { name: 'Toggle thumbnails' }).click();
  await expect(panel.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Pages').getByRole('button')).toHaveCount(3);

  await panel.getByRole('button', { name: 'Collapse panel' }).click();
  await expect(panel).toHaveClass(/collapsed/);
  await expect(page.getByLabel('Pages')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Expand panel' }).click();
  await expect(panel).not.toHaveClass(/collapsed/);
});
