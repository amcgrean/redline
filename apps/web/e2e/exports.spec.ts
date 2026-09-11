/**
 * File menu exports: current page as PNG (with the markup drawn) and the markups summary
 * PDF (one section per marked-up page, a thumbnail per section).
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, rgb } from '@cantoo/pdf-lib';

async function twoPages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i += 1) {
    const page = doc.addPage([720, 480]);
    page.drawRectangle({
      x: 20,
      y: 20,
      width: 680,
      height: 440,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
  }
  return Buffer.from(await doc.save());
}

const status = (page: Page) => page.locator('.status').last();

function pngSize(bytes: Buffer): [number, number] {
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('export PNG and markups summary from the File menu', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'exports.pdf',
    mimeType: 'application/pdf',
    buffer: await twoPages(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  // A filled rectangle so the PNG has colour where the markup is.
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(status(page)).toHaveText('Rectangle');
  await page.keyboard.press('n');
  await page.mouse.click(box.x + 400, box.y + 100);
  await page.getByLabel('Markup text').fill('Check this dimension');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Note');

  const menubar = page.getByRole('menubar');
  const pngDownload = page.waitForEvent('download');
  await menubar.getByRole('menuitem', { name: 'File' }).click();
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: 'Export current page as PNG…' })
    .click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe('exports.p1.png');
  const [w, h] = pngSize(readFileSync((await png.path())!));
  // 720×480 pt at 150 dpi.
  expect(w).toBe(1500);
  expect(h).toBe(1000);
  await expect(status(page)).toContainText('Exported page 1');

  const summaryDownload = page.waitForEvent('download');
  await menubar.getByRole('menuitem', { name: 'File' }).click();
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: 'Export markups summary (PDF)…' })
    .click();
  const summary = await summaryDownload;
  expect(summary.suggestedFilename()).toBe('exports.summary.pdf');
  const pdf = await PDFDocument.load(readFileSync((await summary.path())!));
  expect(pdf.getPageCount()).toBe(1);
  const resources = pdf.getPage(0).node.Resources();
  const xobjects = resources?.lookup(PDFName.of('XObject'));
  expect(xobjects).toBeDefined();
  await expect(status(page)).toContainText('summary');
});
