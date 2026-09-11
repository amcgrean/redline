/**
 * Text search with highlights, text selection via the Text tool, and Print.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

async function labelledPages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const labels = ['FRONT ELEVATION', 'REAR ELEVATION', 'ANCHOR BOLT DETAIL'];
  for (const [i, label] of labels.entries()) {
    const page = doc.addPage([2592, 1728]);
    page.drawRectangle({
      x: 36,
      y: 36,
      width: 2592 - 72,
      height: 1728 - 72,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
    page.drawText(label, { x: 200, y: 1500, size: 72, font });
    page.drawText(`Sheet ${i + 1} of ${labels.length}`, { x: 200, y: 1400, size: 36, font });
  }
  return Buffer.from(await doc.save());
}

async function openDoc(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'labelled.pdf',
    mimeType: 'application/pdf',
    buffer: await labelledPages(),
  });
  await expect(page.locator('canvas').first()).toBeVisible();
}

test('find steps through hits across pages and highlights them', async ({ page }) => {
  await openDoc(page);
  await page.keyboard.press('Control+f');
  const find = page.getByLabel('Find text');
  await expect(find).toBeFocused();

  await find.fill('anchor');
  await expect(page.getByText('1 of 1')).toBeVisible();
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('3');
  await expect(page.getByTestId('find-hit')).toHaveCount(1);

  await find.fill('elevation');
  await expect(page.getByText(/^1 of 2$/)).toBeVisible();
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('1');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^2 of 2$/)).toBeVisible();
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.getByText(/^1 of 2$/)).toBeVisible();

  await find.fill('zzzz');
  await expect(page.getByText('No matches')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(find).toBeHidden();
});

test('the Text tool exposes selectable page text', async ({ page }) => {
  await openDoc(page);
  await expect(page.getByTestId('text-layer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const layer = page.getByTestId('text-layer').first();
  await expect(layer).toBeVisible();
  await expect(layer.locator('span', { hasText: 'FRONT ELEVATION' })).toBeVisible();

  // Select all text on the first page and read the selection back.
  const selected = await page.evaluate(() => {
    const layer = document.querySelector('[data-testid="text-layer"]')!;
    const range = document.createRange();
    range.selectNodeContents(layer);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    return sel.toString();
  });
  expect(selected).toContain('FRONT ELEVATION');
  expect(selected).toContain('Sheet 1 of 3');
});

test('print hands the current bytes to a hidden PDF frame', async ({ page }) => {
  await openDoc(page);
  // Chromium headless has no print UI; stub the frame's print so the flow completes.
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
  await page.getByRole('button', { name: 'Print' }).click();
  const frame = page.locator('iframe[data-print]');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('.status').last()).toHaveText('Sent to print');
});
