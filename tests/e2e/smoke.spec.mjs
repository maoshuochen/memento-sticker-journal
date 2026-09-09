import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { id: 'e2e-user', username: 'tester' } }) }));
  const remoteRecords = new Map();
  const remoteChanges = [];
  let cursor = 0;
  await page.route('**/api/sync/snapshot', (route) => route.fulfill({ json: { cursor, entities: [...remoteRecords.values()] } }));
  await page.route('**/api/sync/pull?*', (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get('cursor'));
    const changes = remoteChanges.filter((change) => change.cursor > after).slice(0, 100);
    return route.fulfill({ json: { cursor: changes.at(-1)?.cursor ?? after, entities: changes.map((change) => change.entity), hasMore: remoteChanges.some((change) => change.cursor > (changes.at(-1)?.cursor ?? after)) } });
  });
  await page.route('**/api/sync/push', (route) => {
    const { changes } = route.request().postDataJSON();
    for (const entity of changes) {
      const key = `${entity.entityType}:${entity.entityId}`;
      const previous = remoteRecords.get(key);
      if (!previous || entity.updatedAt > previous.updatedAt || (entity.updatedAt === previous.updatedAt && entity.revision > previous.revision)) {
        remoteRecords.set(key, entity);
        remoteChanges.push({ cursor: ++cursor, entity });
      }
    }
    return route.fulfill({ json: { cursor, accepted: changes.map((entity) => `${entity.entityType}:${entity.entityId}`), entities: changes.map((entity) => remoteRecords.get(`${entity.entityType}:${entity.entityId}`)) } });
  });
  await page.route('**/api/assets/**', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ remoteKey: 'test', bytes: 1, mimeType: 'image/webp' }) }));
});

test('library gravity, filtering, and sticker details remain tactile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sticker library' })).toBeVisible();
  await expect(page.locator('.gravity-sticker')).toHaveCount(7);
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
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-object-count', '0');
  await expect(page.locator('#saveStatus')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add text' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add tape' })).toBeVisible();
  await expect(page.getByLabel('Journal editor controls')).toBeVisible();
  await expect(page.getByLabel('Journal pages')).toContainText('1 / 5');
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export this page' }).click();
  expect((await exportDownload).suggestedFilename()).toBe('slow-sunday-page-1.png');

  await page.getByRole('button', { name: 'Add strawberry to this page' }).click();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-object-count', '1');
  await expect(page.getByLabel('Selected object actions')).toBeVisible();
  await expect(page.getByLabel('Selected object actions')).toHaveAttribute('data-placement', /above|below/);
  const fabricSurface = page.locator('#fabricJournalCanvas .upper-canvas');
  const surfaceBox = await fabricSurface.boundingBox();
  expect(surfaceBox).not.toBeNull();
  await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.32, surfaceBox.y + surfaceBox.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.32 + 28, surfaceBox.y + surfaceBox.height * 0.3 + 18);
  await page.mouse.up();
  // Persisting a transform rehydrates the Fabric document, but must not clear
  // the user's active object or the contextual controls.
  await expect(page.getByLabel('Selected object actions')).toBeVisible();
  await page.reload();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-object-count', '1');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-object-count', '1');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-object-count', '0');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-object-count', '1');
  await page.getByRole('button', { name: 'Add text' }).click();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-object-count', '2');
  await page.getByRole('button', { name: 'Change text style' }).click();
  await expect(page.getByLabel('Text style options')).toBeVisible();
  await page.getByRole('button', { name: 'Use 手绘 text style' }).click();
  await expect(page.getByLabel('Text style options')).toBeHidden();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-text-fonts', 'handwritten');

  await page.getByRole('button', { name: 'Add tape' }).click();
  await expect(page.getByLabel('Tape preview')).toBeVisible();
  await page.getByRole('button', { name: '胶带底色 #b8d0c0' }).click();
  await page.getByRole('button', { name: '添加胶带', exact: true }).click();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-tape-count', '1');
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-tape-patterns', 'solid');
  await page.waitForTimeout(100);
  await page.reload();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-object-count', '3');
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-text-fonts', 'handwritten');
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-tape-count', '1');
});

test('patterned tape can be added, resized, restyled, restored, and undone', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile';
  if (isMobile) await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/journals');
  await page.getByRole('button', { name: 'Open Slow Sunday, 5 pages' }).click();

  await page.getByRole('button', { name: 'Add tape' }).click();
  const picker = isMobile ? page.getByRole('dialog', { name: '选择胶带图案' }) : page.locator('.tape-pattern-popover');
  await expect(picker).toBeVisible();
  const pickerA11y = await new AxeBuilder({ page }).include(isMobile ? '[role="dialog"]' : '.tape-pattern-popover').analyze();
  expect(pickerA11y.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))).toEqual([]);
  await page.getByRole('option', { name: '草莓' }).click();
  await page.getByRole('button', { name: '添加胶带', exact: true }).click();
  await expect(picker).toBeHidden();
  await page.waitForTimeout(250);
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-tape-patterns', 'emoji:🍓');
  const initialRepeatCount = Number(await page.locator('#fabricJournalCanvas').getAttribute('data-tape-repeat-counts'));
  const surface = page.locator('#fabricJournalCanvas .upper-canvas');
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  // Fabric places the endpoint control beyond the strip by its 6px padding.
  const tapeHalfWidth = box.width * 0.36 / 2 + 6;
  const angle = -5 * Math.PI / 180;
  const handleX = box.x + box.width / 2 + tapeHalfWidth * Math.cos(angle);
  const handleY = box.y + box.height / 2 + tapeHalfWidth * Math.sin(angle);
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX + 54, handleY - 5, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.locator('#fabricJournalCanvas').getAttribute('data-tape-repeat-counts'))).toBeGreaterThan(initialRepeatCount);

  await page.getByRole('button', { name: 'Change tape style' }).click();
  const iconsTab = page.getByRole('tab', { name: 'Icons' });
  await iconsTab.click();
  await expect(iconsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '纯色' })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByText('Emoji 使用系统原生颜色')).toHaveCount(0);
  await page.getByRole('option', { name: '星星' }).click();
  await page.getByRole('button', { name: '图标颜色 #3f5f7a' }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(picker).toBeHidden();
  await page.waitForTimeout(250);
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-tape-patterns', 'icon:star:#3f5f7a');
  const iconPixelCount = await page.locator('#fabricJournalCanvas .lower-canvas').evaluate((canvas) => {
    const context = canvas.getContext('2d');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let matches = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (Math.abs(pixels[index] - 63) < 18 && Math.abs(pixels[index + 1] - 95) < 18 && Math.abs(pixels[index + 2] - 122) < 18 && pixels[index + 3] > 180) matches += 1;
    }
    return matches;
  });
  expect(iconPixelCount).toBeGreaterThan(10);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-tape-patterns', 'emoji:🍓');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-tape-patterns', 'icon:star:#3f5f7a');
  await page.reload();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-tape-patterns', 'icon:star:#3f5f7a');

  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export this page' }).click();
  expect((await exportDownload).suggestedFilename()).toBe('slow-sunday-page-1.png');
});

test('a journal can be created with a selected cover and paper', async ({ page }) => {
  await page.goto('/journals');
  await page.getByRole('button', { name: 'Create a journal' }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new journal' })).toBeVisible();
  await page.getByLabel('Journal name').fill('August pockets');
  await page.getByRole('button', { name: 'Dusty rose cover' }).click();
  await page.getByRole('button', { name: 'soft lines' }).click();
  await page.getByRole('button', { name: 'Create journal' }).click();
  await expect(page.getByRole('region', { name: 'Journal canvas' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Journal canvas' })).toHaveClass(/paper-lined/);
});

test('cutout upload uses multipart, stays within budget, and saves a Blob asset', async ({ page }) => {
  let requestBytes = 0;
  let requestType = '';
  const assetUploads = [];
  await page.route('**/api/assets/**', async (route) => {
    if (route.request().method() === 'PUT') {
      assetUploads.push({
        bytes: route.request().postDataBuffer()?.byteLength ?? 0,
        type: route.request().headers()['content-type'] ?? '',
      });
    }
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ remoteKey: 'test' }) });
  });
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
  await expect.poll(() => assetUploads.length).toBeGreaterThan(0);
  expect(assetUploads.some((upload) => upload.bytes > 0 && /^image\/(png|webp)$/.test(upload.type))).toBe(true);
  // Editable source originals are private JPEGs; the visible sticker render
  // must remain transparent PNG/WebP alongside it.
  expect(assetUploads.some((upload) => upload.bytes > 0 && upload.type === 'image/jpeg')).toBe(true);
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

test('account and sync settings are collected in the profile panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[aria-label="Account and sync status"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open account and settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Account & settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: '立即同步' })).toBeVisible();
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/journals');
  await expect(page.getByRole('button', { name: 'Open sticker library' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open account and settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Account & settings' })).toBeVisible();
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
  expect(api.status()).toBe(401);
  await expect(api.json()).resolves.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
});

test('primary screens have no serious or critical axe violations', async ({ page }) => {
  for (const path of ['/', '/journals']) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
  }
});

test('same-session canvas undo restores the drawing after consecutive moves', async ({ page }) => {
  await page.goto('/journals/journal-1');
  const canvas = page.locator('#fabricJournalCanvas');
  await page.getByRole('button', { name: 'Add strawberry to this page' }).click();
  await expect(canvas).toHaveAttribute('data-object-count', '1');
  const lower = page.locator('#fabricJournalCanvas .lower-canvas');
  const surface = await page.locator('#fabricJournalCanvas .upper-canvas').boundingBox();
  expect(surface).not.toBeNull();
  const x = surface.x + surface.width * .32;
  const y = surface.y + surface.height * .3;
  const drag = async (fromX, fromY, toX, toY) => {
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 5 });
    await page.mouse.up();
  };
  const centroid = () => lower.evaluate((element) => {
    const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
    let weight = 0, sumX = 0, sumY = 0;
    for (let i = 3; i < data.length; i += 4) {
      const alpha = data[i]; const pixel = (i - 3) / 4;
      weight += alpha; sumX += (pixel % element.width) * alpha; sumY += Math.floor(pixel / element.width) * alpha;
    }
    return { x: sumX / weight, y: sumY / weight };
  });
  const initialCenter = await centroid();
  await drag(x, y, x + 25, y + 20);
  await expect.poll(async () => (await centroid()).x - initialCenter.x).toBeGreaterThan(10);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  const firstCenter = await centroid();
  await drag(x + 25, y + 20, x + 55, y + 40);
  await expect.poll(async () => (await centroid()).x - firstCenter.x).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => Math.abs((await centroid()).x - firstCenter.x)).toBeLessThan(3);
  await expect.poll(async () => Math.abs((await centroid()).y - firstCenter.y)).toBeLessThan(3);
});

test('320px layout and cached account survive unavailable APIs after reload', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sticker library' })).toBeVisible();
  await page.getByRole('button', { name: 'Open account and settings' }).click();
  await expect(page.locator('[data-status="synced"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open account and settings' })).toBeFocused();
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sticker library' })).toBeVisible();
  await expect(page.locator('.gravity-sticker')).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open account and settings' }).click();
  await expect(page.locator('[data-status="offline"]')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
});

test('failed sticker decoding preserves page objects and blocks incomplete export until retry', async ({ page }) => {
  await page.route('**/assets/stickers/strawberry.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: 'invalid-image' }));
  await page.goto('/journals/journal-1');
  await page.getByRole('button', { name: 'Add strawberry to this page' }).click();
  const canvas = page.locator('#fabricJournalCanvas');
  await expect(canvas).toHaveAttribute('data-object-count', '1');
  await expect(canvas).toHaveAttribute('data-canvas-load-error', 'true');
  await expect(page.getByRole('button', { name: 'Export this page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Add tape', exact: true }).click();
  await page.getByRole('button', { name: '胶带底色 #b8d0c0' }).click();
  await page.getByRole('button', { name: '添加胶带', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-object-count', '2');
  await page.reload();
  await expect(canvas).toHaveAttribute('data-object-count', '2');
  await expect(canvas).toHaveAttribute('data-canvas-load-error', 'true');
  await page.unroute('**/assets/stickers/strawberry.svg');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-canvas-load-error', 'false');
  await expect(page.getByRole('button', { name: 'Export this page' })).toBeEnabled();
});

test('a pending sticker load cannot insert into the next page', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started = false;
  await page.route('**/assets/stickers/strawberry.svg', async (route) => {
    started = true;
    await gate;
    await route.continue();
  });
  await page.goto('/journals/journal-1');
  await page.getByRole('button', { name: 'Add strawberry to this page' }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByLabel('Journal pages')).toContainText('2 / 5');
  release();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-object-count', '1');
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-text-fonts', /.+/);
  await page.reload();
  await expect(page.getByLabel('Journal pages')).toContainText('2 / 5');
  await expect(page.locator('#fabricJournalCanvas')).toHaveAttribute('data-object-count', '1');
});
