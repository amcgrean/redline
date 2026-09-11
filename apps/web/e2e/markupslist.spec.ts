/**
 * Markups List: sort by value, text filter, this-page filter, XLSX export.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import { strFromU8, unzipSync } from 'fflate';

async function sheets(): Promise<Buffer> {
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

async function openCalibrated(page: Page): Promise<{ x: number; y: number }> {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'list.pdf',
    mimeType: 'application/pdf',
    buffer: await sheets(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const o = { x: box.x + 80, y: box.y + 80 };
  await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  await page.mouse.click(o.x, o.y);
  await page.mouse.click(o.x + 200, o.y);
  await page.getByRole('dialog').getByPlaceholder(`24'-0"`).fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply to page' }).click();
  await expect(page.getByText(/\(calibrated\)/)).toBeVisible();
  return o;
}

test('sorts, filters and exports XLSX', async ({ page }) => {
  const o = await openCalibrated(page);
  await page.keyboard.press('m');
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await page.mouse.click(o.x, o.y + 160);
  await page.mouse.click(o.x + 400, o.y + 160);
  await page.keyboard.press('c');
  await page.mouse.click(o.x, o.y + 300);
  await page.mouse.click(o.x + 100, o.y + 300);
  await page.keyboard.press('Control+Shift+2');
  const list = page.getByTestId('markups-list');
  const lengthRows = list.locator('tbody[data-subject="Length"] tr:not(.group)');
  await expect(lengthRows).toHaveCount(2);
  await expect(lengthRows.nth(0)).toContainText(`10'-0"`);

  // Sort by value: first click ascending (unchanged), second descending.
  const valueHeader = list.getByRole('button', { name: 'Value' });
  await valueHeader.click();
  await valueHeader.click();
  await expect(lengthRows.nth(0)).toContainText(`20'-0"`);

  // Text filter.
  await page.getByLabel('Filter markups').fill('count');
  await expect(list.locator('tbody[data-subject="Length"]')).toHaveCount(0);
  await expect(list.locator('tbody[data-subject="Count"] tr:not(.group)')).toHaveCount(2);
  await expect(page.locator('.markups-toolbar')).toContainText('2 of 4 markups shown');
  await page.getByLabel('Filter markups').fill('');

  // This-page filter: nothing on page 2 yet.
  await page.getByLabel('This page').check();
  await expect(list.locator('tbody[data-subject="Length"] tr:not(.group)')).toHaveCount(2);
  await page.getByLabel('Page', { exact: true }).fill('2');
  await page.getByLabel('Page', { exact: true }).press('Enter');
  await expect(list).toContainText('No markups match.');
  await page.getByLabel('This page').uncheck();

  // XLSX: two sheets, the Markups sheet has four rows plus a header.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export XLSX' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('list.markups.xlsx');
  const files = unzipSync(new Uint8Array(readFileSync((await file.path())!)));
  const workbook = strFromU8(files['xl/workbook.xml']!);
  expect(workbook).toContain('<sheet name="Markups"');
  expect(workbook).toContain('<sheet name="Subtotals"');
  const markups = strFromU8(files['xl/worksheets/sheet1.xml']!);
  expect(markups.match(/<row /g)).toHaveLength(5);
  expect(markups).toContain('<v>20</v>');
  const totals = strFromU8(files['xl/worksheets/sheet2.xml']!);
  expect(totals).toContain('Length');
  expect(totals).toContain('<v>30</v>');
});
