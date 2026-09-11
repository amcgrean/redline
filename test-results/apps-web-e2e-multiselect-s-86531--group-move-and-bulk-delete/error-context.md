# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps\web\e2e\multiselect.spec.ts >> shift-click, marquee, Ctrl+A, group move and bulk delete
- Location: apps\web\e2e\multiselect.spec.ts:53:1

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  1   | /**
  2   |  * Multi-select: Shift-click, marquee, Ctrl+A, group move, bulk delete with one undo.
  3   |  * Calibration: 200 css px = 10 ft.
  4   |  */
  5   | 
  6   | import { expect, test, type Page } from '@playwright/test';
  7   | import { PDFDocument, rgb } from '@cantoo/pdf-lib';
  8   | 
  9   | async function sheet(): Promise<Buffer> {
  10  |   const doc = await PDFDocument.create();
  11  |   const page = doc.addPage([2592, 1728]);
  12  |   page.drawRectangle({
  13  |     x: 36,
  14  |     y: 36,
  15  |     width: 2592 - 72,
  16  |     height: 1728 - 72,
  17  |     borderColor: rgb(0.2, 0.2, 0.2),
  18  |     borderWidth: 2,
  19  |   });
  20  |   return Buffer.from(await doc.save());
  21  | }
  22  | 
  23  | const status = (page: Page) => page.locator('.status').last();
  24  | const hint = (page: Page) => page.locator('.hint');
  25  | 
  26  | async function openWithThreeLengths(page: Page): Promise<{ x: number; y: number }> {
> 27  |   await page.goto('/');
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  28  |   await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
  29  |     name: 'multi.pdf',
  30  |     mimeType: 'application/pdf',
  31  |     buffer: await sheet(),
  32  |   });
  33  |   const canvas = page.locator('canvas').first();
  34  |   await expect(canvas).toBeVisible();
  35  |   const box = (await canvas.boundingBox())!;
  36  |   const o = { x: box.x + 120, y: box.y + 120 };
  37  |   await page.getByRole('button', { name: 'Calibrate (X)' }).click();
  38  |   await page.mouse.click(o.x, o.y);
  39  |   await page.mouse.click(o.x + 200, o.y);
  40  |   await page.getByRole('dialog').getByPlaceholder(`24'-0"`).fill('10');
  41  |   await page.getByRole('dialog').getByRole('button', { name: 'Apply to page' }).click();
  42  |   await expect(page.getByText(/\(calibrated\)/)).toBeVisible();
  43  |   await page.keyboard.press('m');
  44  |   for (const dy of [60, 120, 180]) {
  45  |     await page.mouse.click(o.x, o.y + dy);
  46  |     await page.mouse.click(o.x + 200, o.y + dy);
  47  |     await expect(status(page)).toHaveText(`Length 10'-0"`);
  48  |   }
  49  |   await page.keyboard.press('v');
  50  |   return o;
  51  | }
  52  | 
  53  | test('shift-click, marquee, Ctrl+A, group move and bulk delete', async ({ page }) => {
  54  |   const o = await openWithThreeLengths(page);
  55  | 
  56  |   // Click the first line, shift-click the second.
  57  |   await page.mouse.click(o.x + 100, o.y + 60);
  58  |   await expect(hint(page)).toContainText('selected Line/LineDimension');
  59  |   await page.keyboard.down('Shift');
  60  |   await page.mouse.click(o.x + 100, o.y + 120);
  61  |   await page.keyboard.up('Shift');
  62  |   await expect(hint(page)).toContainText('2 selected');
  63  | 
  64  |   // Group move: drag one of the two by 40 px; both move as one command.
  65  |   await page.mouse.move(o.x + 100, o.y + 120);
  66  |   await page.mouse.down();
  67  |   await page.mouse.move(o.x + 120, o.y + 140, { steps: 3 });
  68  |   await page.mouse.move(o.x + 140, o.y + 160, { steps: 3 });
  69  |   await page.mouse.up();
  70  |   await expect(status(page)).toHaveText('Move 2 markups');
  71  |   await page.keyboard.press('Control+z');
  72  |   await expect(status(page)).toHaveText('Undo Move 2 markups');
  73  | 
  74  |   // Escape clears; a marquee around all three selects three.
  75  |   await page.keyboard.press('Escape');
  76  |   await expect(hint(page)).not.toContainText('selected');
  77  |   await page.mouse.move(o.x - 40, o.y + 30);
  78  |   await page.mouse.down();
  79  |   await page.mouse.move(o.x + 100, o.y + 120, { steps: 4 });
  80  |   await page.mouse.move(o.x + 240, o.y + 210, { steps: 4 });
  81  |   await page.mouse.up();
  82  |   await expect(hint(page)).toContainText('3 selected');
  83  | 
  84  |   // Bulk delete, one undo.
  85  |   await page.keyboard.press('Delete');
  86  |   await expect(status(page)).toHaveText('Delete 3 markups');
  87  |   await page.keyboard.press('Control+Shift+2');
  88  |   await expect(page.getByText('No markups yet.')).toBeVisible();
  89  |   await page.keyboard.press('Control+z');
  90  |   await expect(
  91  |     page.getByTestId('markups-list').locator('tbody[data-subject="Length"] tr:not(.group)'),
  92  |   ).toHaveCount(3);
  93  | 
  94  |   // Ctrl+A on the page.
  95  |   await page.keyboard.press('Escape');
  96  |   await page.keyboard.press('Control+a');
  97  |   await expect(status(page)).toHaveText('3 selected on page 1');
  98  |   await expect(hint(page)).toContainText('3 selected');
  99  | 
  100 |   // Bulk subject edit from Properties.
  101 |   await page.keyboard.press('Control+Shift+4');
  102 |   const panel = page.getByRole('complementary', { name: 'Panel' });
  103 |   await expect(
  104 |     panel.getByText('3 selected — edits and Delete apply to all of them.'),
  105 |   ).toBeVisible();
  106 |   await panel.getByLabel('Subject').fill('Base');
  107 |   await panel.getByLabel('Subject').press('Enter');
  108 |   await page.keyboard.press('Control+Shift+2');
  109 |   await expect(
  110 |     page.getByTestId('markups-list').locator('tbody[data-subject="Base"] tr:not(.group)'),
  111 |   ).toHaveCount(3);
  112 | });
  113 | 
```