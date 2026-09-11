/**
 * Multiple documents in tabs, close with unsaved-changes guard, and recents.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

async function sheet(label: string, pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([2592, 1728]);
    page.drawRectangle({
      x: 36,
      y: 36,
      width: 2592 - 72,
      height: 1728 - 72,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
    page.drawText(`${label} ${i + 1}`, { x: 100, y: 1600, size: 48 });
  }
  return Buffer.from(await doc.save());
}

async function upload(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer,
  });
}

test('two documents open in tabs; switching and closing work', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'alpha.pdf', await sheet('Alpha', 2));
  await expect(page.locator('canvas').first()).toBeVisible();
  await upload(page, 'beta.pdf', await sheet('Beta', 3));

  const tabs = page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Page', { exact: true })).toHaveValue('1');
  await expect(page.locator('.page-indicator')).toContainText('of 3');

  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.page-indicator')).toContainText('of 2');

  // Dirty a document, then closing it asks for confirmation.
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.mouse.click(box.x + 300, box.y + 100);
  await page.getByRole('dialog').getByPlaceholder(`24'-0"`).fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply to page' }).click();
  await expect(tabs.nth(0)).toContainText('alpha.pdf *');

  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'Close alpha.pdf' }).click();
  await expect(tabs).toHaveCount(2);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Close alpha.pdf' }).click();
  await expect(tabs).toHaveCount(1);
  await expect(tabs.nth(0)).toContainText('beta.pdf');
  await expect(page.locator('.page-indicator')).toContainText('of 3');

  // Closing the last one returns to the empty state.
  await page.getByRole('button', { name: 'Close beta.pdf' }).click();
  await expect(page.getByText('Drop a PDF here')).toBeVisible();
});

test('recents list the files opened in this browser profile', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'gamma.pdf', await sheet('Gamma'));
  await expect(page.locator('canvas').first()).toBeVisible();

  await page.reload();
  const recents = page.getByLabel('Recent files');
  await expect(recents).toBeVisible();
  await expect(recents.getByRole('button', { name: 'gamma.pdf', exact: true })).toBeVisible();
  await expect(recents).toContainText('1 pages');

  await recents.getByRole('button', { name: 'Remove gamma.pdf from recents' }).click();
  await expect(recents).toBeHidden();
});
