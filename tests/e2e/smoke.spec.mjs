import { expect, test } from '@playwright/test';

test('journal canvas saves after refresh and backup can be exported', async ({ page }) => {
  await page.goto('index.html');
  await expect(page.getByRole('heading', { name: 'Sticker library' })).toBeVisible();

  await page.getByRole('button', { name: '▱ journal' }).click();
  await page.getByRole('button', { name: 'Open Slow Sunday, 5 pages' }).click();
  await expect(page.getByRole('region', { name: 'Journal canvas' })).toBeVisible();

  await page.getByRole('button', { name: 'Add strawberry to this page' }).click();
  await expect(page.locator('#saveStatus')).toContainText('saved on this device');
  await page.reload();
  await page.getByRole('button', { name: '▱ journal' }).click();
  await page.getByRole('button', { name: 'Open Slow Sunday, 5 pages' }).click();
  await expect(page.getByRole('region', { name: 'Journal canvas' })).toBeVisible();
  await expect(page.locator('#canvasStickers img')).toHaveCount(3);

  await page.getByRole('button', { name: 'Back to my journals' }).click();
  await page.getByRole('button', { name: 'Open sticker library' }).click();
  await page.getByRole('button', { name: 'How Memento works' }).click();
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: 'export backup' }).click();
  await expect(await backup).toBeTruthy();
});

test('library stickers can replay a gravity drop and remain manageable', async ({ page }) => {
  await page.goto('index.html');
  await expect(page.locator('.gravity-sticker')).toHaveCount(9);
  await page.getByRole('button', { name: 'Let stickers fall again' }).click();
  await expect(page.locator('#stickerShelf')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#stickerShelf')).not.toHaveAttribute('aria-busy', 'true', { timeout: 5000 });
  const settledLayout = await page.locator('.gravity-sticker').evaluateAll((stickers, shelf) => {
    const bounds = shelf.getBoundingClientRect();
    return stickers.map((sticker) => {
      const rect = sticker.getBoundingClientRect();
      return { x: Math.round(rect.left - bounds.left), y: Math.round(rect.top - bounds.top), visible: rect.width > 20 && rect.height > 20 };
    });
  }, await page.locator('#stickerShelf').elementHandle());
  expect(settledLayout.every((sticker) => sticker.visible && sticker.x >= -8 && sticker.y >= -8)).toBeTruthy();
  expect(new Set(settledLayout.map((sticker) => `${sticker.x},${sticker.y}`)).size).toBe(9);
  await page.getByRole('button', { name: 'Manage iced cup' }).click();
  await expect(page.getByRole('dialog', { name: 'Sticker details' })).toBeVisible();
  await expect(page.locator('#stickerDetailPreview canvas')).toHaveCount(1);
  await expect(page.locator('#detailPeelHint')).toContainText('Grab the sticker edge');
});

test('cloud cutout explains photo processing before making a network request', async ({ page }) => {
  await page.goto('index.html');
  await page.locator('#photoUpload').setInputFiles('assets/iced-cup-cutout.png');
  await expect(page.getByRole('dialog', { name: 'Pick a subject' })).toBeVisible();
  await page.getByRole('button', { name: 'Cut out subject' }).click();
  await expect(page.getByRole('dialog', { name: 'Your photo leaves this device' })).toBeVisible();
  await expect(page.getByText('The framed part of this photo will be sent to Alibaba Cloud')).toBeVisible();
});

test('a finished cutout gets an interactive peel preview before saving', async ({ page }) => {
  await page.goto('index.html');
  await page.locator('#photoUpload').setInputFiles('assets/iced-cup-cutout.png');
  await page.getByRole('button', { name: 'Cut out subject' }).click();
  await page.getByRole('button', { name: 'use quick cutout' }).click();

  await expect(page.getByRole('dialog', { name: 'Finish your sticker' })).toBeVisible();
  await expect(page.locator('#liveStickerPreview canvas')).toHaveCount(1);
  await expect(page.locator('#peelHint')).toContainText('Grab the sticker edge');
});

test('a validated backup restores only after a replacement confirmation', async ({ page }) => {
  await page.goto('index.html');
  page.once('dialog', (dialog) => dialog.accept());
  const backup = JSON.stringify({
    format: 'memento-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    state: { photos: [], journals: [] }
  });
  await page.locator('#backupUpload').setInputFiles({
    name: 'empty-memento-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup)
  });
  await expect(page.locator('#stickerCount')).toHaveText('0 stickers');
  await expect(page.locator('#toast')).toContainText('Backup restored on this device.');
});
