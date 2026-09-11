/**
 * Undo/redo, zoom presets and page navigation on a three-page document built in-test.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

async function threePages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) {
    const page = doc.addPage([2592, 1728]);
    page.drawRectangle({
      x: 36,
      y: 36,
      width: 2592 - 72,
      height: 1728 - 72,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
    page.drawText(`Sheet ${i + 1}`, { x: 100, y: 1600, size: 48 });
  }
  return Buffer.from(await doc.save());
}

async function openDoc(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'three.pdf',
    mimeType: 'application/pdf',
    buffer: await threePages(),
  });
  await expect(page.locator('canvas').first()).toBeVisible();
}

const status = (page: Page) => page.locator('.status').last();

test('calibrate, draw, undo, redo', async ({ page }) => {
  await openDoc(page);
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height / 2;

  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  await page.mouse.click(box.x + 100, y);
  await page.mouse.click(box.x + 300, y);
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder(`24'-0"`).fill('10');
  await dialog.getByRole('button', { name: 'Apply to page' }).click();
  await expect(page.getByText(/\(calibrated\)/)).toBeVisible();

  await page.getByRole('button', { name: 'Length (M)' }).click();
  await page.mouse.click(box.x + 100, y + 40);
  await page.mouse.click(box.x + 300, y + 40);
  await expect(status(page)).toHaveText(`Length 10'-0"`);

  // Undo the length, then the calibration; redo both.
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(status(page)).toHaveText('Undo Length');
  await undo.click();
  await expect(status(page)).toHaveText('Undo Calibrate page 1');
  await expect(page.getByText('scale: not set')).toBeVisible();
  await expect(undo).toBeDisabled();

  await redo.click();
  await expect(page.getByText(/\(calibrated\)/)).toBeVisible();
  await redo.click();
  await expect(status(page)).toHaveText('Redo Length');
  await expect(redo).toBeDisabled();

  // Keyboard variants.
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Length');
  await page.keyboard.press('Control+y');
  await expect(status(page)).toHaveText('Redo Length');
});

test('zoom presets and page navigation', async ({ page }) => {
  await openDoc(page);
  const zoomLabel = page.getByLabel('Zoom', { exact: true });
  const preset = page.getByLabel('Zoom preset');

  await expect(preset).toHaveValue('fit-width');
  const fitWidth = await zoomLabel.textContent();

  await preset.selectOption('fit-page');
  await expect(preset).toHaveValue('fit-page');
  await expect(zoomLabel).not.toHaveText(fitWidth!);

  await page.keyboard.press('Control+0');
  await expect(zoomLabel).toHaveText('100%');
  await expect(preset).toHaveValue('custom');

  await page.keyboard.press('Control+=');
  await expect(zoomLabel).toHaveText('125%');
  await page.keyboard.press('Control+-');
  await expect(zoomLabel).toHaveText('100%');

  // Page navigation.
  const pageInput = page.getByLabel('Page', { exact: true });
  await expect(pageInput).toHaveValue('1');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(pageInput).toHaveValue('2');
  await page.keyboard.press('PageDown');
  await expect(pageInput).toHaveValue('3');
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await page.keyboard.press('PageUp');
  await expect(pageInput).toHaveValue('2');
  await pageInput.fill('1');
  await expect(pageInput).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
});
