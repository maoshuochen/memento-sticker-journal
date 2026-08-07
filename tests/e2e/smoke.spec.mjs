import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('library gravity, filtering, and sticker details remain tactile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sticker library' })).toBeVisible();
  await expect(page.locator('.gravity-sticker')).toHaveCount(9);
  await expect(page.locator('#stickerShelf')).not.toHaveAttribute('aria-busy', 'true', { timeout: 5_000 });

  await page.getByRole('button', { name: 'Let stickers fall again' }).click();
  await expect(page.locator('#stickerShelf')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#stickerShelf')).not.toHaveAttribute('aria-busy', 'true', { timeout: 5_000 });

  await page.getByRole('button', { name: 'everyday, 1 sticker' }).click();
  await expect(page.locator('.gravity-sticker')).toHaveCount(1);
  await page.getByRole('button', { name: 'Manage bear' }).click();
  await expect(page.getByRole('dialog', { name: 'Sticker details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sticker details' })).toBeHidden();
});

test('journal edits persist through refresh and support history', async ({ page }) => {
  await page.goto('/journals');
  await page.getByRole('button', { name: 'Open Slow Sunday, 5 pages' }).click();
  await expect(page.getByRole('region', { name: 'Journal canvas' })).toBeVisible();
  await expect(page.locator('#canvasStickers .canvas-sticker')).toHaveCount(2);

  await page.getByRole('button', { name: 'Add strawberry to this page' }).click();
  await expect(page.locator('#canvasStickers .canvas-sticker')).toHaveCount(3);
  await expect(page.locator('#saveStatus')).toContainText('saved on this device');
  await page.reload();
  await expect(page.locator('#canvasStickers .canvas-sticker')).toHaveCount(3);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#canvasStickers .canvas-sticker')).toHaveCount(2);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('#canvasStickers .canvas-sticker')).toHaveCount(3);
});

test('a journal can be created with a selected cover and paper', async ({ page }) => {
  await page.goto('/journals');
  await page.getByRole('button', { name: 'Create a journal' }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new journal' })).toBeVisible();
  await page.getByLabel('Journal name').fill('August pockets');
  await page.getByRole('button', { name: 'Dusty rose cover' }).click();
  await page.getByRole('button', { name: 'soft lines' }).click();
  await page.getByRole('button', { name: 'Create journal' }).click();
  await expect(page.getByRole('heading', { name: 'August pockets' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Journal canvas' })).toHaveClass(/paper-lined/);
});

test('cutout upload uses multipart, stays within budget, and saves a Blob asset', async ({ page }) => {
  let requestBytes = 0;
  let requestType = '';
  await page.route('**/api/cutout', async (route) => {
    requestBytes = route.request().postDataBuffer()?.byteLength ?? 0;
    requestType = route.request().headers()['content-type'] ?? '';
    await route.fulfill({ status: 200, path: resolve('public/assets/iced-cup-cutout.png'), contentType: 'image/png' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a photo' }).click();
  await page.getByLabel('Photo file upload').setInputFiles(resolve('public/assets/iced-cup-cutout.png'));
  await expect(page.getByRole('dialog', { name: 'Removing the background…' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Finish your sticker' })).toBeVisible();
  expect(requestType).toContain('multipart/form-data');
  expect(requestBytes).toBeLessThan(3.2 * 1024 * 1024);
  await page.getByLabel('Name').fill('cloud cup');
  await page.getByRole('button', { name: 'Save sticker' }).click();
  await expect(page.getByRole('button', { name: 'Manage cloud cup' })).toBeVisible();
});

test('cloud failure is explicit and never silently becomes a local cutout', async ({ page }) => {
  await page.route('**/api/cutout', (route) => route.fulfill({
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Cloud cutout failed.', code: 'CUTOUT_FAILED' })
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add a photo' }).click();
  await page.getByLabel('Photo file upload').setInputFiles(resolve('public/assets/iced-cup-cutout.png'));
  await expect(page.getByText('Cloud cutout failed.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Finish your sticker' })).toBeHidden();
});

test('backup export and cross-origin migration entry are available', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入 v1 备份' }).click();
  await expect(page.getByRole('dialog', { name: 'Keep the little things' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'export backup' }).click();
  await expect(await download).toBeTruthy();
});

test('workerd serves SPA fallback and rejects the old JSON API contract', async ({ request }) => {
  const route = await request.get('/journals/unknown-journal');
  expect(route.status()).toBe(200);
  expect(route.headers()['content-type']).toContain('text/html');
  expect(route.headers()['x-content-type-options']).toBe('nosniff');

  const api = await request.post('/api/cutout', {
    headers: { 'content-type': 'application/json' },
    data: { image: 'data:image/png;base64,AA==' }
  });
  expect(api.status()).toBe(415);
  await expect(api.json()).resolves.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
});

test('primary screens have no serious or critical axe violations', async ({ page }) => {
  for (const path of ['/', '/journals']) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
  }
});
