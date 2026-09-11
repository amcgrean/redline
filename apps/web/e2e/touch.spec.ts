/**
 * Touch basics: a tap places a count symbol, a one-finger drag draws a rectangle, a
 * pinch zooms the sheet.
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

test.use({ hasTouch: true });

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

test('tap, touch drag, pinch', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'touch.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  const canvas = page.locator('.page[data-page="1"] canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;

  // Tap with the Count tool.
  await page.keyboard.press('c');
  await page.touchscreen.tap(box.x + 100, box.y + 100);
  await expect(status(page)).toHaveText('Count 1');
  await page.touchscreen.tap(box.x + 160, box.y + 100);
  await expect(status(page)).toHaveText('Count 2');

  // One-finger drag with the Rectangle tool, through the CDP touch API.
  await page.keyboard.press('r');
  const cdp = await page.context().newCDPSession(page);
  const start = { x: box.x + 300, y: box.y + 100 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (let i = 1; i <= 5; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x + i * 30, y: start.y + i * 20 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(status(page)).toHaveText('Rectangle');

  // Pinch out: the zoom label grows.
  const zoomLabel = page.locator('[aria-label="Zoom"]');
  const before = (await zoomLabel.textContent()) ?? '';
  const mid = { x: box.x + 400, y: box.y + 300 };
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: mid.x - 40, y: mid.y },
      { x: mid.x + 40, y: mid.y },
    ],
  });
  for (let i = 1; i <= 6; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: mid.x - 40 - i * 20, y: mid.y },
        { x: mid.x + 40 + i * 20, y: mid.y },
      ],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await zoomLabel.textContent()) ?? '').not.toBe(before);
});
