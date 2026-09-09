/**
 * Editable properties: subject rename regroups the Markups List; colour/width/opacity are
 * undoable; a count's subject applies to the whole group.
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

async function openDoc(page: Page): Promise<{ x: number; y: number }> {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'props.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  return { x: box.x + 80, y: box.y + 80 };
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Panel' });
const status = (page: Page) => page.locator('.status').last();

test('rename a length: the Markups List regroups; style edits undo', async ({ page }) => {
  const o = await openDoc(page);
  await panel(page).getByRole('button', { name: `Preset 1/8" = 1'-0"` }).click();
  await page.keyboard.press('m');
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await expect(status(page)).toHaveText(/^Length /);

  await page.keyboard.press('Control+Shift+4');
  const subject = panel(page).getByLabel('Subject');
  await expect(subject).toHaveValue('Length');
  await subject.fill('Ext Wall 2x6');
  await subject.press('Enter');
  await expect(status(page)).toHaveText('Change subject');

  await page.keyboard.press('Control+Shift+2');
  const list = page.getByTestId('markups-list');
  await expect(list.locator('tbody[data-subject="Ext Wall 2x6"] tr')).toHaveCount(2);
  await expect(list.locator('tbody[data-subject="Length"]')).toHaveCount(0);

  await page.keyboard.press('Control+Shift+4');
  await panel(page).getByLabel('Line width').fill('4');
  await expect(status(page)).toHaveText('Change width');
  await expect(panel(page).getByLabel('Line width')).toHaveValue('4');
  // Leave the input first: Ctrl+Z inside a field is the browser's own text undo.
  await panel(page).getByRole('tab', { name: 'Properties' }).click();
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Change width');
  await expect(panel(page).getByLabel('Line width')).toHaveValue('2');

  await panel(page).getByLabel('Stroke colour').fill('#0044cc');
  await expect(status(page)).toHaveText('Change colour');
  await expect(panel(page).getByLabel('Stroke colour')).toHaveValue('#0044cc');
});

test('a count subject applies to the whole group by default', async ({ page }) => {
  const o = await openDoc(page);
  await page.keyboard.press('c');
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 100, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await expect(status(page)).toHaveText('Count 3');

  await page.keyboard.press('Control+Shift+4');
  await expect(panel(page).getByText('Apply to all 3 in this count')).toBeVisible();
  const subject = panel(page).getByLabel('Subject');
  await subject.fill('Studs');
  await subject.press('Enter');
  await expect(status(page)).toHaveText('Change subject');

  await page.keyboard.press('Control+Shift+2');
  const list = page.getByTestId('markups-list');
  await expect(list.locator('tbody[data-subject="Studs"] tr')).toHaveCount(4); // group + 3
  await expect(list.locator('tbody[data-subject="Studs"] [data-testid="subtotal"]')).toHaveText(
    '3 ea',
  );

  // One undo restores all three.
  await page.keyboard.press('Control+z');
  await expect(list.locator('tbody[data-subject="Count"] tr')).toHaveCount(4);
});
