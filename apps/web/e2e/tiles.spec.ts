/**
 * Regression: after rapid zoom changes, every page shows exactly the tiles of the current
 * zoom — no canvas from an earlier zoom lingering at its old size (Aaron's "rendering has
 * an issue" screenshot: an oversized sheet with strips of stale tiles beside it).
 */

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';

async function twoPages(): Promise<Buffer> {
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

/** Every tile canvas must sit inside its page box and match the page's current size class. */
async function tileReport(page: Page) {
  return page.evaluate(() => {
    const out: { page: number; tiles: number; oversized: number; overlapping: number }[] = [];
    for (const p of document.querySelectorAll<HTMLElement>('.page')) {
      const pw = parseFloat(p.style.width);
      const ph = parseFloat(p.style.height);
      const canvases = [...p.querySelectorAll<HTMLCanvasElement>('canvas.tile')];
      const oversized = canvases.filter(
        (c) =>
          c.clientWidth > pw + 1 ||
          c.clientHeight > ph + 1 ||
          parseFloat(c.style.left) + c.clientWidth > pw + 1 ||
          parseFloat(c.style.top) + c.clientHeight > ph + 1,
      ).length;
      const keys = canvases.map((c) => c.getAttribute('data-key'));
      const overlapping = keys.length - new Set(keys).size;
      out.push({ page: Number(p.dataset['page']), tiles: canvases.length, oversized, overlapping });
    }
    return out;
  });
}

test('rapid zoom changes leave no stale tiles', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'tiles.pdf',
    mimeType: 'application/pdf',
    buffer: await twoPages(),
  });
  await expect(page.locator('canvas.tile').first()).toBeVisible();

  // Burst of zooms: in, in, out, out, out, then 100% and fit width.
  for (const key of ['Control+=', 'Control+=', 'Control+-', 'Control+-', 'Control+-']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Control+0');
  await page.keyboard.press('Shift+2');
  await page.waitForTimeout(1500);

  await expect
    .poll(async () => (await tileReport(page)).filter((r) => r.tiles > 0).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  const report = await tileReport(page);
  for (const r of report) {
    expect(r.oversized, `page ${r.page} oversized tiles`).toBe(0);
    expect(r.overlapping, `page ${r.page} duplicate tile keys`).toBe(0);
  }
});
