/**
 * Profile: author name persists across reloads and lands in /T; default units feed the
 * calibrate dialog; export/import round-trip.
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

test('author and units persist, reach new markups, and export/import', async ({ page }) => {
  await page.goto('/');
  // Fresh install: the toolbar asks for a name.
  const profileButton = page.getByRole('button', { name: 'Profile', exact: true });
  await expect(profileButton).toHaveText('Set your name…');
  await profileButton.click();
  const dialog = page.getByRole('dialog', { name: 'Profile' });
  await dialog.getByLabel('Author name').fill('Pat Estimator');
  await dialog.getByLabel('Default display units').selectOption('decimal-ft');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(status(page)).toHaveText('Profile saved');
  await expect(profileButton).toHaveText('Pat Estimator');

  // Survives a reload (IndexedDB).
  await page.reload();
  await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText(
    'Pat Estimator',
  );

  // The calibrate dialog defaults to the profile's units; a length carries the author.
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: 'profile.pdf',
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
  const cal = page.getByRole('dialog', { name: 'Calibrate page scale' });
  await expect(cal.locator('select').first()).toHaveValue('decimal-ft');
  await cal.getByPlaceholder(`24'-0"`).fill('10');
  await cal.getByRole('button', { name: 'Apply to page' }).click();
  await page.keyboard.press('m');
  await page.mouse.click(o.x, o.y + 100);
  await page.mouse.click(o.x + 200, o.y + 100);
  await page.keyboard.press('Control+Shift+2');
  const row = page
    .getByTestId('markups-list')
    .locator('tbody[data-subject="Length"] tr:not(.group)')
    .first();
  await expect(row).toContainText('Pat Estimator');
  await expect(row).toContainText(`10.00'`);

  // Export, then import the file back after changing the name.
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: 'Profile' })
    .getByRole('button', { name: 'Export…' })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Pat_Estimator.profile.json');
  const text = readFileSync((await file.path())!, 'utf8');
  expect(JSON.parse(text)).toMatchObject({ version: 1, author: 'Pat Estimator' });
  await page
    .getByRole('dialog', { name: 'Profile' })
    .getByLabel('Author name')
    .fill('Someone Else');
  await page.getByRole('dialog', { name: 'Profile' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText(
    'Someone Else',
  );
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Profile' })
    .getByLabel('Import profile')
    .setInputFiles((await file.path())!);
  await expect(status(page)).toHaveText('Imported profile "Default"');
  await expect(page.getByRole('button', { name: 'Profile', exact: true })).toHaveText(
    'Pat Estimator',
  );
});
