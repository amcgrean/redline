/**
 * Tool chest: default tools, quick slots, drawing with a tool's subject, Add to Tool Chest,
 * rename, export/import round trip.
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

async function openCalibrated(page: Page): Promise<{ x: number; y: number }> {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'chest.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.keyboard.press('Control+Shift+5');
  await page.getByRole('button', { name: `Preset 1/8" = 1'-0"` }).click();
  await page.keyboard.press('Control+Shift+1');
  return { x: box.x + 80, y: box.y + 80 };
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Panel' });
const status = (page: Page) => page.locator('.status').last();

test('default chest, quick slot, draw with the tool, add a tool from a markup', async ({
  page,
}) => {
  const o = await openCalibrated(page);
  const chest = panel(page).getByRole('listbox', { name: 'Tool chest' });
  await expect(chest.getByRole('option')).toHaveCount(7);
  await expect(panel(page).getByRole('tab', { name: 'Tools' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Slot 3 is Area; drawing uses the tool's subject.
  await page.keyboard.press('3');
  await expect(status(page)).toHaveText('Tool: Area');
  await expect(chest.getByRole('option', { name: 'Area', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 300);
  await page.mouse.click(o.x, o.y + 300);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText(/^Area /);

  // Rename the drawn markup's subject, then make a tool of it.
  await page.keyboard.press('Control+Shift+4');
  const subject = panel(page).getByLabel('Subject');
  await subject.fill('Roofing');
  await subject.press('Enter');
  await panel(page).getByRole('button', { name: 'Add to Tool Chest' }).click();
  await expect(status(page)).toHaveText('Added "Roofing" to the tool chest');
  await expect(chest.getByRole('option')).toHaveCount(8);
  await expect(chest.getByRole('option', { name: 'Roofing' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // The new tool is slot 8 and draws "Roofing" areas.
  await page.keyboard.press('8');
  await expect(status(page)).toHaveText('Tool: Roofing');
  await page.mouse.click(o.x + 300, o.y + 100);
  await page.mouse.click(o.x + 500, o.y + 100);
  await page.mouse.click(o.x + 500, o.y + 300);
  await page.mouse.click(o.x + 300, o.y + 300);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Shift+2');
  await expect(
    page.getByTestId('markups-list').locator('tbody[data-subject="Roofing"] tr'),
  ).toHaveCount(3); // group + 2

  // The chest survives a reload (Dexie).
  await page.evaluate(() => {
    window.onbeforeunload = null;
  });
  await page.reload();
  // The panel only shows with a document open.
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'again.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(
    panel(page).getByRole('listbox', { name: 'Tool chest' }).getByRole('option'),
  ).toHaveCount(8);
});

test('export and import round-trip a chest', async ({ page }) => {
  await openCalibrated(page);
  const chest = panel(page).getByRole('listbox', { name: 'Tool chest' });
  const option = chest.getByRole('option', { name: 'Count', exact: true });
  await option.dblclick();
  await panel(page).getByLabel('Tool subject').fill('Studs');
  await panel(page).getByRole('button', { name: 'OK' }).click();
  await expect(option).toContainText('Studs');

  const download = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: 'Export…' }).click();
  const file = await download;
  const path = await file.path();
  expect(path).toBeTruthy();

  // Remove a tool, then import the exported file: the tool is back.
  await chest.getByRole('button', { name: 'Remove Perimeter' }).click();
  await expect(chest.getByRole('option')).toHaveCount(6);
  await panel(page).getByLabel('Import tool chest').setInputFiles(path!);
  await expect(status(page)).toHaveText(/Imported tool chest "Default" \(7 tools\)/);
  await expect(chest.getByRole('option')).toHaveCount(7);
  await expect(chest.getByRole('option', { name: 'Count', exact: true })).toContainText('Studs');
});
