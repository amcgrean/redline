/**
 * Autosave and crash recovery: dirty a document, reload without saving, recover it
 * with its changes intact; discard removes the offer.
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

async function openAndCalibrate(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  await page.mouse.click(box.x + 100, y);
  await page.mouse.click(box.x + 300, y);
  await page.getByRole('dialog').getByPlaceholder(`24'-0"`).fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply to page' }).click();
  await page.getByRole('button', { name: 'Length (M)' }).click();
  await page.mouse.click(box.x + 100, y + 40);
  await page.mouse.click(box.x + 300, y + 40);
  await expect(page.locator('.status').last()).toHaveText(`Length 10'-0"`);
}

test('unsaved changes survive a reload through autosave + recover', async ({ page }) => {
  await openAndCalibrate(page, 'crash.pdf');
  await expect(page.locator('[data-autosave="saved"]')).toBeVisible({ timeout: 10_000 });

  // Simulate the crash: reload without saving (and without the beforeunload prompt).
  await page.evaluate(() => {
    window.onbeforeunload = null;
  });
  await page.reload();
  const recover = page.getByRole('region', { name: 'Unsaved work' });
  await expect(recover).toBeVisible();
  await expect(recover).toContainText('crash.pdf');

  await recover.getByRole('button', { name: 'Recover crash.pdf' }).click();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByText(/Recovered crash\.pdf/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Save/ })).toBeEnabled();
  // The calibration and the length came back. A recovered file carries the scale in its
  // own /VP, so it reads back as "from document" — exactly as after a Save.
  await expect(page.getByText(/scale: 1 in = \d/)).toBeVisible();
  await expect(page.getByText(/\(from document\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Toggle thumbnails' }).click();
  await expect(page.getByLabel('Pages').getByRole('button')).toHaveCount(1);
  await expect(
    page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab'),
  ).toContainText('crash.pdf *');

  // Once recovered, the offer is gone on the next visit (the slot is reused, not duplicated).
  await page.evaluate(() => {
    window.onbeforeunload = null;
  });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Unsaved work' })).toContainText('crash.pdf');
  await expect(page.getByRole('button', { name: 'Recover crash.pdf' })).toHaveCount(1);
});

test('discard removes the recovery offer', async ({ page }) => {
  await openAndCalibrate(page, 'discard.pdf');
  await expect(page.locator('[data-autosave="saved"]')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    window.onbeforeunload = null;
  });
  await page.reload();
  const recover = page.getByRole('region', { name: 'Unsaved work' });
  await recover.getByRole('button', { name: 'Discard discard.pdf' }).click();
  await expect(recover).toBeHidden();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Unsaved work' })).toHaveCount(0);
});

test('a clean save clears the autosave', async ({ page }) => {
  // Headless Chromium exposes showSaveFilePicker but never resolves it; force the
  // download fallback so Save completes.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
  });
  await openAndCalibrate(page, 'clean.pdf');
  await expect(page.locator('[data-autosave="saved"]')).toBeVisible({ timeout: 10_000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Save/ }).click();
  await download;
  await expect(page.locator('.status').last()).toHaveText(/^Saved clean\.pdf/);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Unsaved work' })).toHaveCount(0);
});
