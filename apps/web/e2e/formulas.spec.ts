/**
 * Tool attributes and formulas (PLAN §3.8, Phase 3 acceptance): the default 'Wall LF'
 * tool carries a wall height; the Markups List shows wall area and stud count columns
 * with subtotals; editing the height in Properties recomputes; CSV carries the columns;
 * a formula added in the tool editor appears as a new column.
 */

import { readFileSync } from 'node:fs';
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
const list = (page: Page) => page.getByTestId('markups-list');

test('wall LF tool: height attribute, formula columns, subtotals, CSV, tool editor', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'walls.pdf',
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

  // Quick slot 7: Wall LF (height 9 ft, stud spacing 16 in). 10 ft and 20 ft runs.
  await page.keyboard.press('7');
  await expect(status(page)).toContainText('Wall LF');
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await page.mouse.click(o.x, o.y + 160);
  await page.mouse.click(o.x + 400, o.y + 160);
  await page.keyboard.press('Control+Shift+2');
  const rows = list(page).locator('tbody[data-subject="Wall"] tr:not(.group)');
  await expect(rows).toHaveCount(2);
  await expect(list(page).locator('thead')).toContainText('Wall area (sf)');
  await expect(list(page).locator('thead')).toContainText('Studs');
  // 10 ft × 9 ft = 90 sf; studs = ceil(120/16) + 1 = 9. 20 ft: 180 sf, 16 studs.
  await expect(rows.nth(0).locator('td[data-formula="wallArea"]')).toHaveText('90');
  await expect(rows.nth(0).locator('td[data-formula="studs"]')).toHaveText('9');
  await expect(rows.nth(1).locator('td[data-formula="wallArea"]')).toHaveText('180');
  const group = list(page).locator('tbody[data-subject="Wall"] tr.group');
  await expect(group.locator('td[data-formula="wallArea"]')).toHaveText('270');
  await expect(group.locator('td[data-formula="studs"]')).toHaveText('25');

  // Change the first wall's height to 10 ft in Properties.
  await rows.nth(0).click();
  await page.keyboard.press('Control+Shift+4');
  const height = page.getByLabel('Wall height');
  await expect(height).toHaveValue('9');
  await height.fill('10');
  await height.press('Enter');
  await expect(status(page)).toHaveText('Change attribute');
  await height.blur(); // shortcuts are ignored while typing in an input
  await page.keyboard.press('Control+Shift+2');
  await expect(rows.nth(0).locator('td[data-formula="wallArea"]')).toHaveText('100');
  await expect(group.locator('td[data-formula="wallArea"]')).toHaveText('280');

  // CSV carries the formula columns and their subtotals.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const text = readFileSync((await (await download).path())!, 'utf8').replace(/^/, '');
  const lines = text.trim().split(/\r?\n/);
  expect(lines[0]).toContain('Wall area (sf),Studs');
  expect(lines.some((l) => l.startsWith('Wall,1,Length,') && l.includes(',100,9,'))).toBe(true);
  expect(lines.some((l) => l.startsWith('Wall,,Subtotal,') && l.includes(',280,25,'))).toBe(true);

  // Add a formula in the tool editor: a new column appears.
  await page.keyboard.press('Control+Shift+1');
  await page.getByRole('button', { name: 'Edit Wall LF attributes' }).click();
  const dialog = page.getByRole('dialog', { name: /Attributes of Wall LF/ });
  await dialog.getByRole('button', { name: '+ Formula' }).click();
  await dialog.getByLabel('Formula 3 key').fill('plates');
  await dialog.getByLabel('Formula 3 label').fill('Plates (lf)');
  await dialog.getByLabel('Formula 3 expression').fill('length * 3');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.keyboard.press('Control+Shift+2');
  await expect(list(page).locator('thead')).toContainText('Plates (lf)');
  await expect(rows.nth(1).locator('td[data-formula="plates"]')).toHaveText('60');
});
