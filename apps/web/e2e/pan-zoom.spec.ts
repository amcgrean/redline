/**
 * Wheel zoom and the Pan tool (H, Space-hold, middle button).
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

async function openDoc(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'pan.pdf',
    mimeType: 'application/pdf',
    buffer: await sheet(),
  });
  await expect(page.locator('canvas').first()).toBeVisible();
}

const zoomPercent = async (page: Page) =>
  Number((await page.getByLabel('Zoom', { exact: true }).textContent())!.replace('%', ''));

const scrollTop = (page: Page) =>
  page.getByTestId('viewer').evaluate((el) => (el as HTMLElement).scrollTop);

test('the scroll wheel zooms around the cursor; Shift+wheel scrolls', async ({ page }) => {
  await openDoc(page);
  const viewer = page.getByTestId('viewer');
  const box = (await viewer.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const before = await zoomPercent(page);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(before);
  await expect(page.getByLabel('Zoom preset')).toHaveValue('custom');

  const zoomedIn = await zoomPercent(page);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => zoomPercent(page)).toBeLessThan(zoomedIn);

  // Shift+wheel is left to the browser (scrolls, no zoom change).
  await page.keyboard.press('Control+0');
  await expect.poll(() => zoomPercent(page)).toBe(100);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Shift');
  await expect.poll(() => zoomPercent(page)).toBe(100);
});

test('Pan tool, Space-hold and middle button drag the view', async ({ page }) => {
  await openDoc(page);
  await page.keyboard.press('Control+0'); // 100%: the sheet is far larger than the viewport
  const viewer = page.getByTestId('viewer');
  const box = (await viewer.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Pan tool (H): drag up moves the content up => scrollTop grows.
  await page.keyboard.press('h');
  await expect(page.getByRole('button', { name: 'Pan (H)' })).toHaveClass(/active/);
  const start = await scrollTop(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 150, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(start + 100);

  // Back to Select; a plain drag must NOT pan.
  await page.keyboard.press('v');
  const afterPan = await scrollTop(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 150, { steps: 5 });
  await page.mouse.up();
  expect(await scrollTop(page)).toBe(afterPan);

  // Space-hold from Select pans.
  await page.keyboard.down('Space');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 150, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(afterPan + 100);

  // Middle button pans from any tool.
  const afterSpace = await scrollTop(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx, cy - 150, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(afterSpace + 100);
});
