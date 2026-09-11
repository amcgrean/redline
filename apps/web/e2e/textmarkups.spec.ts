/**
 * Text box, callout and note tools with the inline editor; edit existing text.
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

const status = (page: Page) => page.locator('.status').last();
const hint = (page: Page) => page.locator('.hint');
const editor = (page: Page) => page.getByLabel('Markup text').last();

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

test('text box, callout and note; edit by double-click', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'text.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const o = { x: box.x + 80, y: box.y + 80 };

  // Text box: drag, type, Ctrl+Enter.
  await page.keyboard.press('t');
  await drag(page, [o.x, o.y], [o.x + 220, o.y + 60]);
  await expect(editor(page)).toBeVisible();
  await editor(page).fill('Verify plate height');
  await page.keyboard.press('Control+Enter');
  await expect(status(page)).toHaveText('Text box');
  await expect(hint(page)).toContainText('selected FreeText');
  await expect(hint(page)).toContainText('Verify plate height');

  // Callout: click the target, drag the box, type, click away to commit.
  await page.keyboard.press('k');
  await page.mouse.click(o.x + 40, o.y + 200);
  await drag(page, [o.x + 200, o.y + 120], [o.x + 420, o.y + 170]);
  await expect(editor(page)).toBeVisible();
  await editor(page).fill('Missing header');
  await page.keyboard.press('Control+Enter');
  await expect(status(page)).toHaveText('Callout');
  await expect(hint(page)).toContainText('selected FreeText/FreeTextCallout');

  // Note: click, type, Enter.
  await page.keyboard.press('n');
  await page.mouse.click(o.x + 40, o.y + 300);
  await expect(editor(page)).toBeVisible();
  await editor(page).fill('Check with the framer');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Note');
  await expect(hint(page)).toContainText('selected Text');

  await page.keyboard.press('Control+Shift+2');
  const list = page.getByTestId('markups-list');
  for (const subject of ['Text', 'Callout', 'Note']) {
    await expect(list.locator(`tbody[data-subject="${subject}"] tr:not(.group)`)).toHaveCount(1);
  }

  // Edit the text box by double-clicking it in Select mode.
  await page.keyboard.press('v');
  await page.mouse.dblclick(o.x + 60, o.y + 30);
  await expect(editor(page)).toBeVisible();
  await editor(page).fill('Verify plate height on site');
  await page.keyboard.press('Control+Enter');
  await expect(status(page)).toHaveText('Edit text');
  await expect(hint(page)).toContainText('Verify plate height on site');
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('Undo Edit text');
});
