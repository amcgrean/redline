/**
 * Split: every-N and ranges download one file per part, each carrying its pages' markups.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

async function fivePages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 5; i += 1) {
    const page = doc.addPage([1000 + i * 100, 500]);
    page.drawRectangle({
      x: 20,
      y: 20,
      width: 960 + i * 100,
      height: 460,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 2,
    });
  }
  return Buffer.from(await doc.save());
}

const status = (page: Page) => page.locator('.status').last();

async function collectDownloads(page: Page, count: number, trigger: () => Promise<void>) {
  const downloads: Download[] = [];
  const done = new Promise<void>((resolve) => {
    page.on('download', (d) => {
      downloads.push(d);
      if (downloads.length === count) resolve();
    });
  });
  await trigger();
  await done;
  return downloads;
}

test('split every 2 pages and by ranges', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'set.pdf',
    mimeType: 'application/pdf',
    buffer: await fivePages(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.keyboard.press('n');
  await page.mouse.click(box.x + 60, box.y + 60);
  await page.getByLabel('Markup text').fill('first');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Note');

  await page.keyboard.press('Control+Shift+3');
  page.once('dialog', (d) => void d.accept('2'));
  const parts = await collectDownloads(page, 3, async () => {
    await page.getByRole('button', { name: 'Split', exact: true }).click();
  });
  await expect(status(page)).toHaveText('Split into 3 files');
  expect(parts.map((d) => d.suggestedFilename()).sort()).toEqual([
    'set.p1-2.pdf',
    'set.p3-4.pdf',
    'set.p5.pdf',
  ]);
  const first = parts.find((d) => d.suggestedFilename() === 'set.p1-2.pdf')!;
  const pdf = await PDFDocument.load(readFileSync((await first.path())!));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPage(0).getWidth()).toBe(1000);
  expect(pdf.getPage(0).node.Annots()?.size()).toBe(1);

  page.once('dialog', (d) => void d.accept('1-3, 5'));
  const ranges = await collectDownloads(page, 2, async () => {
    await page.getByRole('button', { name: 'Split', exact: true }).click();
  });
  expect(ranges.map((d) => d.suggestedFilename()).sort()).toEqual(['set.p1-3.pdf', 'set.p5.pdf']);

  page.once('dialog', (d) => void d.accept('9'));
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(status(page)).toHaveText('Split into 1 file');
});
