const cutoutAssets = [
  './assets/iced-cup-cutout.png',
  './assets/coffee-cutout.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/1f353.svg',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/1f337.svg',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/1f950.svg',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/1f4f7.svg',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/1f352.svg',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/1f9f8.svg',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/1fab4.svg'
];
let photos = [
  { name: 'iced cup', image: cutoutAssets[0], border: 'sticker-polaroid', tilt: '-5deg' },
  { name: 'coffee note', image: cutoutAssets[1], border: 'sticker-torn', tilt: '6deg' },
  { name: 'strawberry', image: cutoutAssets[2], border: 'sticker-clean', tilt: '-2deg' },
  { name: 'tulip', image: cutoutAssets[3], border: 'sticker-torn', tilt: '3deg' },
  { name: 'croissant', image: cutoutAssets[4], border: 'sticker-polaroid', tilt: '-7deg' },
  { name: 'little camera', image: cutoutAssets[5], border: 'sticker-clean', tilt: '5deg' },
  { name: 'cherries', image: cutoutAssets[6], border: 'sticker-polaroid', tilt: '2deg' },
  { name: 'bear', image: cutoutAssets[7], border: 'sticker-torn', tilt: '-4deg' },
  { name: 'plant', image: cutoutAssets[8], border: 'sticker-clean', tilt: '7deg' }
].map((item, index) => ({
  ...item,
  id: `sample-${index + 1}`,
  group: ['food + drink', 'food + drink', 'summer 2026', 'summer 2026', 'food + drink', 'little finds', 'summer 2026', 'everyday', 'little finds'][index],
  finish: ['edge-soft', 'edge-bold', 'edge-lift'][index % 3],
  edgeThickness: [2, 4, 3][index % 3],
  createdAt: Date.now() - index * 86400000
}));

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const backdrop = $('#sheetBackdrop');
let selectedSubject = 'Strawberry soda';
let selectedFinish = 'edge-soft';
let selectedEdgeThickness = 3;
let selectedPaper = 'paper-grid';
let selectedCover = 'cover-blue';
let activeJournal = 0;
let selectedCanvasSticker = null;
let activeStickerId = null;
let stickerSearchQuery = '';
let activeGroupFilter = 'all';
let stickerSortMode = 'recent';
let highestLayer = 6;
let workingImageSource = null;
let workingCutoutInput = null;
let workingCutoutSource = null;
let cameraStream = null;
let subjectSelection = { left: .16, top: .14, width: .68, height: .64 };
const stickerGroups = ['summer 2026', 'everyday', 'food + drink', 'little finds'];
let selectedGroup = stickerGroups[0];
const STORAGE_KEY = 'memento-journal-v2';
const STORAGE_DB_NAME = 'memento-journal';
const STORAGE_STORE_NAME = 'app-state';
let storageDbPromise = null;
let saveQueue = Promise.resolve();
let storageWarningShown = false;
let lastFocusedElement = null;
let toastTimer = null;
let promptIndex = 0;
const journalPrompts = [
  'What small thing made today feel like yours?',
  'What color kept showing up today?',
  'What would you like to remember from this hour?',
  'What did you notice because you slowed down?',
  'Which ordinary thing felt quietly special?'
];

function makeId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`; }
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
}
function setSaveStatus(message) {
  const status = $('#saveStatus');
  if (status) status.textContent = message;
}
function openStorageDb() {
  if (storageDbPromise) return storageDbPromise;
  storageDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORAGE_STORE_NAME)) request.result.createObjectStore(STORAGE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local storage.'));
    request.onblocked = () => reject(new Error('Local storage is blocked by another tab.'));
  });
  return storageDbPromise;
}

async function readStoredState() {
  const db = await openStorageDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORAGE_STORE_NAME, 'readonly').objectStore(STORAGE_STORE_NAME).get(STORAGE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not read local storage.'));
  });
}

async function writeStoredState(state) {
  const db = await openStorageDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORAGE_STORE_NAME, 'readwrite');
    transaction.objectStore(STORAGE_STORE_NAME).put(state, STORAGE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not save local storage.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not save local storage.'));
  });
}

function applyStoredState(saved) {
  if (!saved) return;
  if (Array.isArray(saved.photos) && saved.photos.length) {
    photos = saved.photos.map((photo, index) => ({
      ...photo,
      group: photo.group || 'everyday',
      createdAt: photo.createdAt || Date.now() - index
    }));
  }
  if (Array.isArray(saved.journals) && saved.journals.length) {
    journals.splice(0, journals.length, ...saved.journals.map((journal) => ({
      ...journal,
      pageContents: journal.pageContents || {},
      pageWords: journal.pageWords || {},
      history: journal.history || {}
    })));
  }
}

function reportStorageProblem(error) {
  console.warn('Could not save journal data locally', error);
  setSaveStatus('not saved');
  if (storageWarningShown) return;
  storageWarningShown = true;
  window.setTimeout(() => showToast('Local saving is unavailable in this browser.'), 0);
}

function saveApp() {
  const snapshot = JSON.parse(JSON.stringify({ photos, journals }));
  setSaveStatus('saving…');
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(() => writeStoredState(snapshot))
    .then(() => setSaveStatus('saved on this device'))
    .catch(reportStorageProblem);
  return saveQueue;
}

async function loadApp() {
  try {
    const saved = await readStoredState();
    if (saved) {
      applyStoredState(saved);
      return;
    }
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (!legacy) return;
    const migrated = JSON.parse(legacy);
    applyStoredState(migrated);
    await writeStoredState(migrated);
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    reportStorageProblem(error);
  }
}
const journals = [
  { id: 'journal-1', title: 'Slow Sunday', year: 'July 2026', pages: 5, page: 1, cover: 'cover-blue', paper: 'paper-grid', pageContents: {}, pageWords: {}, history: {} },
  { id: 'journal-2', title: 'Small rituals', year: 'Spring 2026', pages: 8, page: 3, cover: 'cover-cocoa', paper: 'paper-plain', pageContents: {}, pageWords: {}, history: {} },
  { id: 'journal-3', title: 'Out & about', year: '2025', pages: 12, page: 7, cover: 'cover-sun', paper: 'paper-calendar', pageContents: {}, pageWords: {}, history: {} },
  { id: 'journal-4', title: 'Tender things', year: '2025', pages: 4, page: 2, cover: 'cover-rose', paper: 'paper-grid', pageContents: {}, pageWords: {}, history: {} }
];

function makeSticker(item, className = '') {
  const sticker = document.createElement('div');
  sticker.className = `sticker cutout ${item.finish || 'edge-soft'} ${className}`;
  sticker.style.setProperty('--tilt', item.tilt || '0deg');
  sticker.style.setProperty('--edge', `${item.edgeThickness ?? 3}px`);
  const image = document.createElement('img');
  image.src = item.image;
  image.alt = item.name || 'Sticker';
  sticker.append(image);
  return sticker;
}

function getVisibleStickers() {
  const query = stickerSearchQuery.trim().toLocaleLowerCase();
  const filtered = photos.filter((item) => {
    const matchesQuery = !query || `${item.name} ${item.group || ''}`.toLocaleLowerCase().includes(query);
    const matchesGroup = activeGroupFilter === 'all' || item.group === activeGroupFilter;
    return matchesQuery && matchesGroup;
  });
  return filtered.sort((a, b) => {
    if (stickerSortMode === 'name') return (a.name || '').localeCompare(b.name || '');
    if (stickerSortMode === 'group') return (a.group || '').localeCompare(b.group || '') || (a.name || '').localeCompare(b.name || '');
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function renderGroupFilters() {
  const filters = $('#groupFilters');
  filters.innerHTML = '';
  ['all', ...stickerGroups].forEach((group) => {
    const count = group === 'all' ? photos.length : photos.filter((item) => item.group === group).length;
    if (group !== 'all' && count === 0) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `group-pill ${activeGroupFilter === group ? 'is-active' : ''}`;
    button.textContent = group;
    button.setAttribute('aria-pressed', String(activeGroupFilter === group));
    button.setAttribute('aria-label', `${group}, ${count} ${count === 1 ? 'sticker' : 'stickers'}`);
    button.addEventListener('click', () => {
      activeGroupFilter = group;
      renderGroupFilters();
      renderLibrary(false);
    });
    filters.append(button);
  });
}

function renderLibrary(withDrop = true) {
  const shelf = $('#stickerShelf');
  const falling = $('#fallingStickers');
  const visiblePhotos = getVisibleStickers();
  $('#stickerCount').textContent = visiblePhotos.length === photos.length ? `${photos.length} stickers` : `${visiblePhotos.length} of ${photos.length}`;
  $('#stickerEmpty').hidden = visiblePhotos.length !== 0;
  shelf.innerHTML = '';
  falling.innerHTML = '';
  const pile = [[0, 0], [91, 0], [182, 0], [273, 0], [45, 88], [136, 88], [227, 88], [91, 184], [182, 184]];
  const drifts = [-28, 18, -15, 24, 20, -24, 15, -18, 20];
  visiblePhotos.forEach((item, i) => {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'sticker-slot';
    slot.setAttribute('aria-label', `Manage ${item.name}`);
    slot.style.setProperty('--slot-delay', `${withDrop ? 0.42 + i * 0.1 : 0}s`);
    slot.style.setProperty('--pile-left', `${pile[i % pile.length][0]}px`);
    slot.style.setProperty('--pile-bottom', `${pile[i % pile.length][1]}px`);
    slot.style.setProperty('--fall-drift', `${drifts[i % drifts.length]}px`);
    slot.append(makeSticker(item));
    slot.addEventListener('click', () => openStickerDetail(item.id));
    shelf.append(slot);
    if (withDrop && i < 6) {
      const fallingItem = document.createElement('div');
      fallingItem.className = 'falling';
      fallingItem.style.cssText = `--x:${10 + (i % 3) * 105}px;--rot:${(i - 3) * 10}deg;--delay:${i * 0.09}s`;
      fallingItem.append(makeSticker(item));
      falling.append(fallingItem);
    }
  });
  renderGroupFilters();
}

function openStickerDetail(stickerId) {
  const item = photos.find((photo) => photo.id === stickerId);
  if (!item) return;
  activeStickerId = stickerId;
  const preview = $('#stickerDetailPreview');
  preview.innerHTML = '';
  preview.append(makeSticker(item, 'detail-sticker'));
  $('#stickerDetailName').value = item.name || '';
  $('#stickerDetailGroup').innerHTML = `${item.group || 'everyday'} <span>⌄</span>`;
  $('#deleteSticker').textContent = 'delete';
  $('#deleteSticker').dataset.confirming = 'false';
  openSheet('stickerDetailSheet');
}

function refreshStickerSurfaces() {
  renderLibrary(false);
  renderTray();
  renderCanvasDock();
  saveApp();
}

function activeDialog() { return [...document.querySelectorAll('.overlay-screen.open, .bottom-sheet.open')].at(-1) || null; }
function rememberFocus() {
  if (!activeDialog() && document.activeElement instanceof HTMLElement) lastFocusedElement = document.activeElement;
}
function focusDialog(dialog) {
  window.requestAnimationFrame(() => dialog.querySelector('button, input, [tabindex]:not([tabindex="-1"])')?.focus({ preventScroll: true }));
}
function restoreFocus() {
  window.requestAnimationFrame(() => {
    if (lastFocusedElement?.isConnected) lastFocusedElement.focus({ preventScroll: true });
  });
}

function openSheet(id) {
  // Bottom sheets share one interaction layer. Keeping more than one open made
  // the first-run guide cover the import options when a user acted quickly.
  rememberFocus();
  $$('.bottom-sheet').forEach((sheet) => {
    const isTarget = sheet.id === id;
    sheet.classList.toggle('open', isTarget);
    sheet.setAttribute('aria-hidden', String(!isTarget));
  });
  backdrop.classList.add('visible');
  focusDialog($(`#${id}`));
}
function closeSheets(shouldRestoreFocus = true) {
  backdrop.classList.remove('visible');
  $$('.bottom-sheet').forEach((el) => { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); });
  if (shouldRestoreFocus) restoreFocus();
}
function openOverlay(id) {
  rememberFocus();
  closeSheets(false);
  $$('.overlay-screen').forEach((overlay) => {
    if (overlay.id === id) return;
    if (overlay.id === 'captureScreen') stopCamera();
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  });
  $(`#${id}`).classList.add('open');
  $(`#${id}`).setAttribute('aria-hidden', 'false');
  focusDialog($(`#${id}`));
}
function closeOverlay(id) {
  if (id === 'captureScreen') stopCamera();
  $(`#${id}`).classList.remove('open');
  $(`#${id}`).setAttribute('aria-hidden', 'true');
  if (!activeDialog()) restoreFocus();
}
function setScreen(id) {
  $$('.screen').forEach((screen) => screen.classList.remove('active'));
  $(`#${id}`).classList.add('active');
  const journal = id === 'journalScreen';
  $('#libraryNav').classList.toggle('is-active', !journal);
  $('#journalNav').classList.toggle('is-active', journal);
  $('#canvasAdd').classList.remove('visible');
  if (id !== 'libraryScreen') setSearchOpen(false);
}

function addToCanvas(item, saved = null, shouldSelect = true) {
  const canvas = $('#canvasStickers');
  const placed = makeSticker(item, 'canvas-sticker');
  const locations = [[204, 125, 8], [38, 247, -8], [189, 253, 4]];
  const [defaultLeft, defaultTop, defaultAngle] = locations[canvas.children.length % locations.length];
  const state = saved || {};
  placed.style.left = `${state.left ?? defaultLeft}px`;
  placed.style.top = `${state.top ?? defaultTop}px`;
  const restoredLayer = Number(state.zIndex);
  const zIndex = Number.isFinite(restoredLayer) ? restoredLayer : ++highestLayer;
  highestLayer = Math.max(highestLayer, zIndex);
  placed.style.zIndex = `${zIndex}`;
  placed.dataset.angle = state.angle ?? defaultAngle;
  placed.dataset.scale = state.scale ?? '1';
  placed.dataset.stickerId = item.id || '';
  placed.dataset.finish = item.finish || 'edge-soft';
  placed.style.transform = `rotate(${placed.dataset.angle}deg) scale(${placed.dataset.scale})`;
  addStickerHandles(placed);
  placed.addEventListener('pointerdown', startStickerDrag);
  canvas.append(placed);
  if (shouldSelect) { selectCanvasSticker(placed); closeSheets(); commitHistory(); }
  return placed;
}

function canvasSnapshot() {
  return [...$('#canvasStickers').children].map((sticker) => ({
    id: sticker.dataset.stickerId, left: parseFloat(sticker.style.left), top: parseFloat(sticker.style.top),
    angle: Number(sticker.dataset.angle), scale: Number(sticker.dataset.scale), zIndex: Number(sticker.style.zIndex)
  }));
}
function currentJournal() { return journals[activeJournal]; }
function storeCurrentPage() {
  const journal = currentJournal();
  if (!journal || !$('#journalDetailScreen').classList.contains('open')) return;
  journal.pageContents[journal.page] = canvasSnapshot();
  saveApp();
}
function commitHistory() {
  const journal = currentJournal();
  if (!journal || !$('#journalDetailScreen').classList.contains('open')) return;
  const key = journal.page; journal.history[key] ||= { entries: [], index: -1 };
  const history = journal.history[key]; history.entries = history.entries.slice(0, history.index + 1);
  history.entries.push(canvasSnapshot()); if (history.entries.length > 30) history.entries.shift();
  history.index = history.entries.length - 1; storeCurrentPage();
  updateHistoryControls();
}
function restoreCanvas(snapshot) {
  const canvas = $('#canvasStickers'); canvas.innerHTML = '';
  snapshot.forEach((saved) => { const item = photos.find((photo) => photo.id === saved.id); if (item) addToCanvas(item, saved, false); });
  clearCanvasSelection();
}
function undoRedo(direction) {
  const journal = currentJournal(); const history = journal?.history?.[journal?.page];
  if (!history) return; const index = history.index + direction;
  if (index < 0 || index >= history.entries.length) return;
  history.index = index; restoreCanvas(history.entries[index]); storeCurrentPage(); updateHistoryControls();
}
function updateHistoryControls() {
  const history = currentJournal()?.history?.[currentJournal()?.page];
  if (!history) return;
  $('#undoButton').disabled = history.index <= 0;
  $('#redoButton').disabled = history.index >= history.entries.length - 1;
}

function addStickerHandles(sticker) {
  sticker.insertAdjacentHTML('beforeend', '<button class="sticker-handle delete-handle" aria-label="Delete sticker">×</button><button class="sticker-handle rotate-handle" aria-label="Rotate sticker">↻</button><button class="sticker-handle resize-handle" aria-label="Resize sticker">↘</button><div class="sticker-toolbar"><button data-layer="down" aria-label="Send sticker backward">↓</button><button data-layer="up" aria-label="Bring sticker forward">↑</button></div>');
  sticker.querySelector('.delete-handle').addEventListener('click', (event) => { event.stopPropagation(); sticker.remove(); clearCanvasSelection(); commitHistory(); });
  sticker.querySelector('.resize-handle').addEventListener('pointerdown', (event) => startStickerTransform(event, sticker, 'resize'));
  const rotateHandle = sticker.querySelector('.rotate-handle');
  rotateHandle.addEventListener('pointerdown', (event) => startStickerTransform(event, sticker, 'rotate'));
  rotateHandle.addEventListener('click', (event) => {
    if (rotateHandle.dataset.wasDragged === 'true') { rotateHandle.dataset.wasDragged = 'false'; return; }
    event.stopPropagation(); sticker.dataset.angle = Number(sticker.dataset.angle) + 15; applyStickerTransform(sticker); commitHistory();
  });
  sticker.querySelectorAll('[data-layer]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    const current = Number(sticker.style.zIndex || 1);
    sticker.style.zIndex = `${button.dataset.layer === 'up' ? ++highestLayer : Math.max(1, current - 1)}`;
    commitHistory();
  }));
}

function applyStickerTransform(sticker) {
  sticker.style.transform = `rotate(${sticker.dataset.angle}deg) scale(${sticker.dataset.scale})`;
}

function selectCanvasSticker(sticker) {
  if (selectedCanvasSticker && selectedCanvasSticker !== sticker) selectedCanvasSticker.classList.remove('is-selected');
  selectedCanvasSticker = sticker;
  sticker.classList.add('is-selected');
  $('#canvasHint').classList.add('is-hidden');
}

function clearCanvasSelection() {
  if (selectedCanvasSticker) selectedCanvasSticker.classList.remove('is-selected');
  selectedCanvasSticker = null;
}

function startStickerDrag(event) {
  if (event.target.closest('.sticker-handle, .sticker-toolbar')) return;
  event.preventDefault();
  const sticker = event.currentTarget;
  selectCanvasSticker(sticker);
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = parseFloat(sticker.style.left);
  const startTop = parseFloat(sticker.style.top);
  const canvas = $('#journalCanvas');
  const move = (moveEvent) => {
    const maxX = canvas.clientWidth - sticker.offsetWidth;
    const maxY = canvas.clientHeight - sticker.offsetHeight;
    sticker.style.left = `${Math.max(-15, Math.min(maxX + 15, startLeft + moveEvent.clientX - startX))}px`;
    sticker.style.top = `${Math.max(55, Math.min(maxY + 25, startTop + moveEvent.clientY - startY))}px`;
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    commitHistory();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end, { once: true });
  window.addEventListener('pointercancel', end, { once: true });
}

function startStickerTransform(event, sticker, mode) {
  event.preventDefault(); event.stopPropagation(); selectCanvasSticker(sticker);
  const handle = event.currentTarget;
  handle.setPointerCapture?.(event.pointerId);
  const startX = event.clientX; const startY = event.clientY;
  const startScale = Number(sticker.dataset.scale); const startAngle = Number(sticker.dataset.angle);
  const rect = sticker.getBoundingClientRect(); const centerX = rect.left + rect.width / 2; const centerY = rect.top + rect.height / 2;
  const startPointerAngle = Math.atan2(startY - centerY, startX - centerX) * 180 / Math.PI;
  let moved = false;
  const move = (moveEvent) => {
    if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 3) moved = true;
    if (mode === 'resize') {
      const distance = (moveEvent.clientX - startX) + (moveEvent.clientY - startY);
      sticker.dataset.scale = Math.max(.55, Math.min(2.2, startScale + distance / 135));
    } else {
      const pointerAngle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180 / Math.PI;
      sticker.dataset.angle = Math.round(startAngle + pointerAngle - startPointerAngle);
    }
    applyStickerTransform(sticker);
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    if (mode === 'rotate' && moved) handle.dataset.wasDragged = 'true';
    commitHistory();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end, { once: true });
  handle.addEventListener('pointercancel', end, { once: true });
}

function renderJournalBooks() {
  const shelf = $('#journalBooks');
  shelf.innerHTML = '';
  journals.forEach((journal, index) => {
    const book = document.createElement('button');
    book.className = `journal-book ${journal.cover}`;
    book.setAttribute('aria-label', `Open ${journal.title}, ${journal.pages} pages`);
    const inner = document.createElement('span');
    inner.className = 'journal-book-inner';
    const year = document.createElement('span');
    year.className = 'book-year';
    year.textContent = journal.year;
    const title = document.createElement('h2');
    title.textContent = journal.title;
    const pages = document.createElement('span');
    pages.className = 'book-pages';
    pages.textContent = `${journal.pages} pages · page ${journal.page}`;
    inner.append(year, title, pages);
    book.append(inner);
    book.addEventListener('click', () => openJournal(index));
    shelf.append(book);
  });
}

function renderPage() {
  const journal = journals[activeJournal];
  journal.pageWords ||= {};
  $('#journalTitle').textContent = journal.title;
  $('#journalDate').textContent = journal.year;
  $('#journalPageCount').textContent = `page ${journal.page} of ${journal.pages}`;
  $('#journalCanvas').className = `journal-canvas ${journal.paper}`;
  const words = journal.pageWords[journal.page] || {
    headline: journal.page === 1 ? 'soft morning, still warm.' : '',
    note: journal.page === 1 ? 'save what made you smile' : ''
  };
  $('.canvas-line-one').textContent = words.headline || '';
  $('.canvas-line-two').textContent = words.note || '';
  $('.canvas-line-one').classList.toggle('is-empty', !words.headline);
  $('.canvas-line-two').classList.toggle('is-empty', !words.note);
  $('#canvasStickers').innerHTML = '';
  const savedPage = journal.pageContents[journal.page];
  if (Array.isArray(savedPage)) {
    restoreCanvas(savedPage);
  } else if (photos.length) {
    addToCanvas(photos[(journal.page - 1) % photos.length], null, false);
    if (journal.page % 2) addToCanvas(photos[journal.page % photos.length], null, false);
    journal.pageContents[journal.page] = canvasSnapshot();
    journal.history[journal.page] = { entries: [canvasSnapshot()], index: 0 };
  } else {
    journal.pageContents[journal.page] = [];
    journal.history[journal.page] = { entries: [[]], index: 0 };
  }
  const dots = $('#pageDots');
  dots.innerHTML = '';
  const firstVisiblePage = Math.max(1, Math.min(journal.page - 2, journal.pages - 4));
  const lastVisiblePage = Math.min(journal.pages, firstVisiblePage + 4);
  for (let i = firstVisiblePage; i <= lastVisiblePage; i += 1) {
    const dot = document.createElement('button');
    dot.className = `page-dot ${i === journal.page ? 'is-current' : ''}`;
    dot.setAttribute('aria-label', `Open page ${i}`);
    dot.addEventListener('click', () => changeJournalPage(i));
    dots.append(dot);
  }
  $('#prevPage').disabled = journal.page === 1;
  $('#nextPage').disabled = journal.page === journal.pages;
  clearCanvasSelection();
  updateHistoryControls();
}

function changeJournalPage(page) { storeCurrentPage(); currentJournal().page = page; renderPage(); saveApp(); }

function openJournal(index) {
  activeJournal = index;
  openOverlay('journalDetailScreen');
  $('#canvasAdd').classList.remove('visible');
  renderCanvasDock();
  renderPage();
}

function closeJournalDetail() {
  storeCurrentPage();
  closeOverlay('journalDetailScreen');
  $('#canvasAdd').classList.remove('visible');
  renderJournalBooks();
}

function addJournalPage() {
  const journal = journals[activeJournal];
  storeCurrentPage();
  journal.pages += 1;
  journal.page = journal.pages;
  journal.pageContents[journal.page] = [];
  journal.pageWords ||= {};
  journal.pageWords[journal.page] = { headline: '', note: '' };
  journal.history[journal.page] = { entries: [[]], index: 0 };
  renderPage();
  saveApp();
}

function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  $('#cameraVideo').srcObject = null;
  $('#captureScreen').classList.remove('camera-ready');
}

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { $('#cameraUpload').click(); return; }
  openOverlay('captureScreen');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    $('#cameraVideo').srcObject = cameraStream;
    $('#captureScreen').classList.add('camera-ready');
  } catch (error) {
    closeOverlay('captureScreen');
    $('#cameraUpload').click();
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
}

function normalizePhoto(fileOrSource) {
  return new Promise((resolve, reject) => {
    const isObjectUrl = typeof fileOrSource !== 'string';
    const source = isObjectUrl ? URL.createObjectURL(fileOrSource) : fileOrSource;
    const releaseSource = () => { if (isObjectUrl) URL.revokeObjectURL(source); };
    const image = new Image();
    image.onload = () => {
      try {
        const max = 1600; const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('Could not read photo')); return; }
          blobToDataUrl(blob).then(resolve, reject);
        }, 'image/jpeg', .9);
      } catch (error) {
        reject(error);
      } finally {
        releaseSource();
      }
    };
    image.onerror = () => { releaseSource(); reject(new Error('Could not open photo')); };
    image.src = source;
  });
}

function normalizeCutout(blob) {
  return new Promise((resolve, reject) => {
    const source = URL.createObjectURL(blob); const image = new Image();
    image.onload = () => {
      const max = 1200; const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (result) => { URL.revokeObjectURL(source); if (!result) return reject(new Error('Could not prepare cutout')); resolve(await blobToDataUrl(result)); }, 'image/png');
    };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error('Could not prepare cutout')); };
    image.src = source;
  });
}

function renderSubjectSelection() {
  const selection = $('#subjectSelection');
  selection.style.left = `${subjectSelection.left * 100}%`;
  selection.style.top = `${subjectSelection.top * 100}%`;
  selection.style.width = `${subjectSelection.width * 100}%`;
  selection.style.height = `${subjectSelection.height * 100}%`;
}

async function cropSubjectSelection() {
  const image = new Image(); image.src = workingImageSource; await image.decode();
  const frame = $('.selected-photo').getBoundingClientRect();
  const scale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale; const renderedHeight = image.naturalHeight * scale;
  const offsetX = (frame.width - renderedWidth) / 2; const offsetY = (frame.height - renderedHeight) / 2;
  const selectedLeft = subjectSelection.left * frame.width;
  const selectedTop = subjectSelection.top * frame.height;
  const selectedWidth = subjectSelection.width * frame.width;
  const selectedHeight = subjectSelection.height * frame.height;
  const padding = Math.max(selectedWidth, selectedHeight) * .045;
  const x = Math.max(0, Math.round((selectedLeft - padding - offsetX) / scale));
  const y = Math.max(0, Math.round((selectedTop - padding - offsetY) / scale));
  const right = Math.min(image.naturalWidth, Math.round((selectedLeft + selectedWidth + padding - offsetX) / scale));
  const bottom = Math.min(image.naturalHeight, Math.round((selectedTop + selectedHeight + padding - offsetY) / scale));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, right - x); canvas.height = Math.max(1, bottom - y);
  canvas.getContext('2d').drawImage(image, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not frame the subject.')), 'image/jpeg', .9));
  return blobToDataUrl(blob);
}

function prepareSubjectPhoto(source) {
  workingImageSource = source;
  workingCutoutInput = null;
  workingCutoutSource = null;
  subjectSelection = { left: .16, top: .14, width: .68, height: .64 };
  renderSubjectSelection();
  selectedFinish = 'edge-soft';
  selectedEdgeThickness = 3;
  $$('.border-choice').forEach((choice) => choice.classList.toggle('is-chosen', choice.dataset.finish === selectedFinish));
  $('#edgeThickness').value = selectedEdgeThickness;
  $('#edgeThickness').style.setProperty('--range-progress', `${((selectedEdgeThickness - 1) / 9) * 100}%`);
  $('#edgeThicknessValue').textContent = `${selectedEdgeThickness} px`;
  $('#liveStickerPreview').className = `sticker cutout live-sticker large-sticker ${selectedFinish}`;
  $('#liveStickerPreview').style.setProperty('--edge', `${selectedEdgeThickness}px`);
  $('#subjectPhoto').src = source;
  $('#subjectStatus').textContent = 'Frame your subject first';
  $('#selectedSubjectName').textContent = 'What should stay?';
  $('#subjectDescription').textContent = 'Drag a frame around the thing you want to keep. AI will use this frame to make a cleaner sticker.';
  $('#makeStickerButton').classList.remove('is-processing');
  $('#makeStickerButton').dataset.mode = '';
  $('#makeStickerButton').innerHTML = 'Cut out subject <span>→</span>';
  openOverlay('subjectScreen');
}

let selectionGesture = null;
const subjectFrame = $('.selected-photo');
function framePoint(event) {
  const frame = subjectFrame.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(frame.width, event.clientX - frame.left)),
    y: Math.max(0, Math.min(frame.height, event.clientY - frame.top)),
    width: frame.width,
    height: frame.height
  };
}
subjectFrame.addEventListener('pointerdown', (event) => {
  if (!workingImageSource || !$('#subjectScreen').classList.contains('open')) return;
  const point = framePoint(event);
  selectionGesture = { start: point, previous: { ...subjectSelection }, moved: false };
  subjectFrame.setPointerCapture(event.pointerId);
  event.preventDefault();
});
subjectFrame.addEventListener('pointermove', (event) => {
  if (!selectionGesture) return;
  const point = framePoint(event); const { start } = selectionGesture;
  if (Math.abs(point.x - start.x) > 8 || Math.abs(point.y - start.y) > 8) selectionGesture.moved = true;
  if (!selectionGesture.moved) return;
  subjectSelection = {
    left: Math.min(start.x, point.x) / point.width,
    top: Math.min(start.y, point.y) / point.height,
    width: Math.abs(point.x - start.x) / point.width,
    height: Math.abs(point.y - start.y) / point.height
  };
  renderSubjectSelection();
  $('#subjectStatus').textContent = 'Frame set';
  $('#selectedSubjectName').textContent = 'Your selection';
});
subjectFrame.addEventListener('pointerup', (event) => {
  if (!selectionGesture) return;
  if (!selectionGesture.moved) subjectSelection = selectionGesture.previous;
  else {
    const point = framePoint(event); const minimum = 38;
    subjectSelection.width = Math.max(subjectSelection.width, minimum / point.width);
    subjectSelection.height = Math.max(subjectSelection.height, minimum / point.height);
    subjectSelection.left = Math.min(subjectSelection.left, 1 - subjectSelection.width);
    subjectSelection.top = Math.min(subjectSelection.top, 1 - subjectSelection.height);
  }
  renderSubjectSelection();
  selectionGesture = null;
});
subjectFrame.addEventListener('pointercancel', () => { if (selectionGesture) { subjectSelection = selectionGesture.previous; renderSubjectSelection(); selectionGesture = null; } });

async function capturePhoto() {
  const video = $('#cameraVideo');
  if (!cameraStream || !video.videoWidth) { $('#photoUpload').click(); return; }
  const canvas = $('#cameraCanvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const source = await normalizePhoto(canvas.toDataURL('image/jpeg', .92));
  stopCamera();
  prepareSubjectPhoto(source);
}

async function receiveUpload(file) {
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { alert('Please choose a photo smaller than 12 MB.'); return; }
  try { prepareSubjectPhoto(await normalizePhoto(file)); } catch (error) { alert('That photo could not be opened.'); }
}

async function cutOutSubject() {
  if (!workingImageSource) return;
  if ($('#makeStickerButton').dataset.mode === 'quick') { quickCutout(); return; }
  const button = $('#makeStickerButton');
  button.classList.add('is-processing'); button.innerHTML = 'Cutting out… <span>◌</span>';
  $('#subjectStatus').textContent = 'Finding your subject';
  try {
    workingCutoutInput = await cropSubjectSelection();
    const result = await fetch('/api/cutout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: workingCutoutInput })
    });
    if (!result.ok) {
      const detail = await result.json().catch(() => ({}));
      throw new Error(detail.error || 'Cloud cutout could not finish.');
    }
    workingCutoutSource = await normalizeCutout(await result.blob());
    $('#liveStickerPreview img').src = workingCutoutSource;
    $('#subjectStatus').textContent = 'Subject cut out';
    button.classList.remove('is-processing');
    openOverlay('saveScreen');
  } catch (error) {
    button.classList.remove('is-processing'); button.dataset.mode = 'quick'; button.innerHTML = 'Use quick cutout <span>→</span>';
    $('#subjectStatus').textContent = 'Cloud cutout is unavailable';
    $('#subjectDescription').textContent = error.message === 'Cloud cutout is not configured yet.' ? 'Add the Alibaba Cloud credentials in Vercel to turn on AI cutout.' : 'Use quick cutout for a clean, solid background, then try cloud cutout again.';
  }
}

function colorDistance(data, index, color) { return Math.hypot(data[index] - color[0], data[index + 1] - color[1], data[index + 2] - color[2]); }
async function quickCutout() {
  const button = $('#makeStickerButton'); button.classList.add('is-processing'); button.innerHTML = 'Removing background… <span>◌</span>';
  try {
    const image = new Image(); image.src = workingCutoutInput || workingImageSource; await image.decode();
    const max = 1200; const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height); const { data } = pixels; const width = canvas.width; const height = canvas.height;
    const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
    const base = corners.reduce((sum, [x, y]) => { const i = (y * width + x) * 4; sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; return sum; }, [0, 0, 0]).map((value) => value / 4);
    const visited = new Uint8Array(width * height); const queue = new Int32Array(width * height); let head = 0; let tail = 0;
    const enqueue = (x, y) => { const point = y * width + x; if (!visited[point]) { visited[point] = 1; queue[tail++] = point; } };
    for (let x = 0; x < width; x += 1) { enqueue(x, 0); enqueue(x, height - 1); }
    for (let y = 1; y < height - 1; y += 1) { enqueue(0, y); enqueue(width - 1, y); }
    while (head < tail) {
      const point = queue[head++]; const x = point % width; const y = Math.floor(point / width); const pixel = point * 4;
      if (colorDistance(data, pixel, base) > 78) continue;
      data[pixel + 3] = 0;
      if (x > 0) enqueue(x - 1, y); if (x < width - 1) enqueue(x + 1, y); if (y > 0) enqueue(x, y - 1); if (y < height - 1) enqueue(x, y + 1);
    }
    context.putImageData(pixels, 0, 0);
    const result = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not make cutout')), 'image/png'));
    workingCutoutSource = await normalizeCutout(result); $('#liveStickerPreview img').src = workingCutoutSource;
    button.classList.remove('is-processing'); button.dataset.mode = ''; openOverlay('saveScreen');
  } catch (error) {
    button.classList.remove('is-processing'); button.innerHTML = 'Try quick cutout again <span>→</span>';
    $('#subjectStatus').textContent = 'Quick cutout could not read this photo';
  }
}

async function exportCurrentPage() {
  const button = $('#exportButton');
  const original = button.textContent;
  button.textContent = '…'; button.disabled = true;
  try {
    const module = await import('https://esm.sh/html2canvas@1.4.1');
    const image = await module.default($('#journalCanvas'), { backgroundColor: '#faf7ed', scale: 2, useCORS: true });
    const link = document.createElement('a');
    link.href = image.toDataURL('image/png');
    link.download = `${currentJournal().title.toLowerCase().replace(/\s+/g, '-')}-page-${currentJournal().page}.png`;
    link.click();
  } catch (error) {
    alert('This page could not be exported yet. Please try again once the page images have loaded.');
  } finally { button.textContent = original; button.disabled = false; }
}

$('#addButton').addEventListener('click', () => openSheet('importSheet'));
$('#cameraOption').addEventListener('click', startCamera);
$('#uploadOption').addEventListener('click', () => $('#photoUpload').click());
$('#takePhoto').addEventListener('click', capturePhoto);
$('#continueFromCapture').addEventListener('click', () => $('#photoUpload').click());
$('#subjectNext').addEventListener('click', cutOutSubject);
$('#makeStickerButton').addEventListener('click', cutOutSubject);
$('#photoUpload').addEventListener('change', (event) => { receiveUpload(event.target.files[0]); event.target.value = ''; });
$('#cameraUpload').addEventListener('change', (event) => { receiveUpload(event.target.files[0]); event.target.value = ''; });
$('#libraryNav').addEventListener('click', () => setScreen('libraryScreen'));
$('#journalNav').addEventListener('click', () => setScreen('journalScreen'));
$('#backToLibrary').addEventListener('click', () => setScreen('libraryScreen'));
$('#profileButton').addEventListener('click', () => { setSearchOpen(false); openSheet('helpSheet'); });
$('#closeHelp').addEventListener('click', () => { localStorage.setItem('memento-guide-seen', 'true'); closeSheets(); });
function openNewJournalSheet() {
  selectedPaper = 'paper-grid';
  selectedCover = 'cover-blue';
  $('#journalNameInput').value = '';
  $$('.paper-card').forEach((item) => item.classList.toggle('is-chosen', item.dataset.paper === selectedPaper));
  $$('.cover-choice').forEach((item) => item.classList.toggle('is-chosen', item.dataset.cover === selectedCover));
  openSheet('newJournalSheet');
}
$('#newBookButton').addEventListener('click', openNewJournalSheet);
$('#createBookCard').addEventListener('click', openNewJournalSheet);
$('#closeJournalDetail').addEventListener('click', closeJournalDetail);
$('#newJournalButton').addEventListener('click', addJournalPage);
$('#exportButton').addEventListener('click', exportCurrentPage);
$('#canvasAdd').addEventListener('click', () => openSheet('stickerTray'));
$('#journalCanvas').addEventListener('pointerdown', (event) => { if (event.target === $('#journalCanvas') || event.target === $('#canvasStickers')) clearCanvasSelection(); });
$('#undoButton').addEventListener('click', () => undoRedo(-1));
$('#redoButton').addEventListener('click', () => undoRedo(1));
$('#prevPage').addEventListener('click', () => { if (journals[activeJournal].page > 1) changeJournalPage(journals[activeJournal].page - 1); });
$('#nextPage').addEventListener('click', () => { const journal = journals[activeJournal]; if (journal.page < journal.pages) changeJournalPage(journal.page + 1); });
backdrop.addEventListener('click', closeSheets);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if ($('#searchPanel').classList.contains('is-open')) {
      setSearchOpen(false);
      $('#searchToggle').focus();
      return;
    }
    const activeSheet = $$('.bottom-sheet.open').at(-1);
    if (activeSheet) {
      closeSheets();
      return;
    }
    const activeOverlay = $$('.overlay-screen.open').at(-1);
    if (activeOverlay) closeOverlay(activeOverlay.id);
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = activeDialog();
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hasAttribute('hidden'));
  if (!focusable.length) { event.preventDefault(); return; }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
$$('[data-close]').forEach((button) => button.addEventListener('click', () => { const target = button.dataset.close; if (target === 'stickerTray') closeSheets(); else closeOverlay(target); }));

$$('.subject-hit').forEach((hit) => hit.addEventListener('click', () => {
  $$('.subject-hit').forEach((item) => item.classList.remove('is-selected'));
  hit.classList.add('is-selected'); selectedSubject = hit.dataset.subject; $('#selectedSubjectName').textContent = selectedSubject;
}));

$$('.border-choice').forEach((choice) => choice.addEventListener('click', () => {
  $$('.border-choice').forEach((item) => item.classList.remove('is-chosen'));
  choice.classList.add('is-chosen'); selectedFinish = choice.dataset.finish;
  $('#liveStickerPreview').className = `sticker cutout live-sticker large-sticker ${selectedFinish}`;
}));

$('#edgeThickness').addEventListener('input', (event) => {
  selectedEdgeThickness = Number(event.target.value);
  $('#edgeThicknessValue').textContent = `${selectedEdgeThickness} px`;
  event.target.style.setProperty('--range-progress', `${((selectedEdgeThickness - 1) / 9) * 100}%`);
  $('#liveStickerPreview').style.setProperty('--edge', `${selectedEdgeThickness}px`);
});

let isSavingSticker = false;
$('#saveStickerButton').addEventListener('click', () => {
  if (isSavingSticker) return;
  isSavingSticker = true;
  $('#saveStickerButton').disabled = true;
  const name = $('#stickerNameInput').value.trim() || selectedSubject;
  const item = { id: makeId('sticker'), name: name.toLowerCase(), group: selectedGroup, image: workingCutoutSource || cutoutAssets[0], finish: selectedFinish, edgeThickness: selectedEdgeThickness, tilt: '-4deg', createdAt: Date.now() };
  photos.unshift(item);
  closeOverlay('saveScreen');
  closeOverlay('subjectScreen');
  setScreen('libraryScreen');
  renderLibrary(false); renderTray(); renderCanvasDock();
  saveApp();
  window.setTimeout(() => { isSavingSticker = false; $('#saveStickerButton').disabled = false; }, 350);
});

$('#groupPicker').addEventListener('click', () => {
  selectedGroup = stickerGroups[(stickerGroups.indexOf(selectedGroup) + 1) % stickerGroups.length];
  $('#groupPicker').innerHTML = `${selectedGroup} <span>⌄</span>`;
});

$$('.paper-card').forEach((card) => card.addEventListener('click', () => { $$('.paper-card').forEach((item) => item.classList.remove('is-chosen')); card.classList.add('is-chosen'); selectedPaper = card.dataset.paper; }));
$$('.cover-choice').forEach((choice) => choice.addEventListener('click', () => {
  $$('.cover-choice').forEach((item) => item.classList.remove('is-chosen'));
  choice.classList.add('is-chosen');
  selectedCover = choice.dataset.cover;
}));
$('#createJournalButton').addEventListener('click', () => {
  const titles = ['A little book', 'Small days', 'Things I saw', 'Kept close'];
  const title = $('#journalNameInput').value.trim() || titles[journals.length % titles.length];
  const now = new Date();
  const year = now.toLocaleDateString('en', { month: 'long', year: 'numeric' });
  const journal = { id: makeId('journal'), title, year, pages: 1, page: 1, cover: selectedCover, paper: selectedPaper, pageContents: { 1: [] }, pageWords: { 1: { headline: '', note: '' } }, history: { 1: { entries: [[]], index: 0 } } };
  journals.unshift(journal);
  closeSheets();
  setScreen('journalScreen');
  renderJournalBooks();
  openJournal(0);
  saveApp();
  showToast(`${title} is ready.`);
});

function renderTray() { const tray = $('#trayStickers'); tray.innerHTML = ''; photos.slice(0, 7).forEach((item) => { const button = document.createElement('button'); button.className = 'tray-choice'; button.setAttribute('aria-label', `Place ${item.name}`); button.append(makeSticker(item)); button.addEventListener('click', () => addToCanvas(item)); tray.append(button); }); }
function renderCanvasDock() {
  const dock = $('#canvasStickerDock'); dock.innerHTML = '';
  photos.forEach((item) => {
    const card = document.createElement('button');
    card.className = 'dock-sticker'; card.setAttribute('aria-label', `Add ${item.name} to this page`);
    card.append(makeSticker(item));
    card.addEventListener('pointerdown', (event) => startDockDrag(event, item, card));
    card.addEventListener('click', () => { if (card.dataset.ignoreClick === 'true') { card.dataset.ignoreClick = 'false'; return; } addToCanvas(item); });
    dock.append(card);
  });
}
function startDockDrag(event, item, card) {
  const startX = event.clientX; const startY = event.clientY; let dragging = false; let ghost = null;
  const appRect = document.querySelector('.app-shell').getBoundingClientRect();
  const beginDrag = () => { dragging = true; card.dataset.ignoreClick = 'true'; ghost = makeSticker(item, 'drag-ghost'); document.querySelector('.app-shell').append(ghost); ghost.style.left = `${startX - appRect.left}px`; ghost.style.top = `${startY - appRect.top}px`; };
  // A zero-delay mouse drag turned every desktop click into a cancelled drag.
  // Keep tap/click as the quick-add action, and start dragging on movement or hold.
  const timer = window.setTimeout(beginDrag, 180);
  const move = (moveEvent) => {
    if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 10) { window.clearTimeout(timer); beginDrag(); }
    if (!dragging) return;
    moveEvent.preventDefault(); ghost.style.left = `${moveEvent.clientX - appRect.left}px`; ghost.style.top = `${moveEvent.clientY - appRect.top}px`;
  };
  const end = (endEvent, shouldPlace = true) => {
    window.clearTimeout(timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', cancel);
    if (!dragging) return;
    const rect = $('#journalCanvas').getBoundingClientRect();
    if (shouldPlace && endEvent.clientX >= rect.left && endEvent.clientX <= rect.right && endEvent.clientY >= rect.top && endEvent.clientY <= rect.bottom) addToCanvas(item, { left: endEvent.clientX - rect.left - 40, top: endEvent.clientY - rect.top - 45, angle: 0, scale: 1, zIndex: ++highestLayer }, true);
    ghost.remove();
  };
  const cancel = () => end(null, false);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end, { once: true });
  window.addEventListener('pointercancel', cancel, { once: true });
}

$('#stickerSearch').addEventListener('input', (event) => {
  stickerSearchQuery = event.target.value;
  $('#clearSearch').classList.toggle('is-visible', Boolean(stickerSearchQuery));
  $('#searchToggle').classList.toggle('has-query', Boolean(stickerSearchQuery));
  renderLibrary(false);
});
$('#clearSearch').addEventListener('click', () => {
  stickerSearchQuery = '';
  $('#stickerSearch').value = '';
  $('#clearSearch').classList.remove('is-visible');
  $('#searchToggle').classList.remove('has-query');
  $('#stickerSearch').focus();
  renderLibrary(false);
});
function setSearchOpen(isOpen) {
  const panel = $('#searchPanel');
  panel.classList.toggle('is-open', isOpen);
  panel.setAttribute('aria-hidden', String(!isOpen));
  $('#searchToggle').setAttribute('aria-expanded', String(isOpen));
  if (isOpen) window.setTimeout(() => $('#stickerSearch').focus(), 0);
}
$('#searchToggle').addEventListener('click', () => {
  setSearchOpen(!$('#searchPanel').classList.contains('is-open'));
});
document.addEventListener('pointerdown', (event) => {
  if ($('#searchPanel').classList.contains('is-open') && !event.target.closest('.library-screen .topbar')) {
    setSearchOpen(false);
  }
});

$('#stickerDetailName').addEventListener('change', (event) => {
  const item = photos.find((photo) => photo.id === activeStickerId);
  const nextName = event.target.value.trim();
  if (!item || !nextName) {
    if (item) event.target.value = item.name;
    return;
  }
  item.name = nextName;
  refreshStickerSurfaces();
  showToast('Sticker name updated.');
});
$('#stickerDetailGroup').addEventListener('click', () => {
  const item = photos.find((photo) => photo.id === activeStickerId);
  if (!item) return;
  item.group = stickerGroups[(stickerGroups.indexOf(item.group) + 1) % stickerGroups.length];
  $('#stickerDetailGroup').innerHTML = `${item.group} <span>⌄</span>`;
  refreshStickerSurfaces();
});
$('#deleteSticker').addEventListener('click', (event) => {
  const button = event.currentTarget;
  if (button.dataset.confirming !== 'true') {
    button.dataset.confirming = 'true';
    button.textContent = 'tap again to delete';
    window.setTimeout(() => {
      if (button.dataset.confirming === 'true') {
        button.dataset.confirming = 'false';
        button.textContent = 'delete';
      }
    }, 2600);
    return;
  }
  const item = photos.find((photo) => photo.id === activeStickerId);
  photos = photos.filter((photo) => photo.id !== activeStickerId);
  activeStickerId = null;
  closeSheets();
  refreshStickerSurfaces();
  showToast(`${item?.name || 'Sticker'} removed.`);
});
$('#placeStickerInJournal').addEventListener('click', () => {
  const item = photos.find((photo) => photo.id === activeStickerId);
  if (!item || !journals.length) return;
  closeSheets(false);
  setScreen('journalScreen');
  openJournal(Math.min(activeJournal, journals.length - 1));
  addToCanvas(item);
  showToast('Sticker placed — drag it anywhere.');
});

$('#editPageWords').addEventListener('click', () => {
  const journal = currentJournal();
  journal.pageWords ||= {};
  const words = journal.pageWords[journal.page] || {
    headline: $('.canvas-line-one').textContent,
    note: $('.canvas-line-two').textContent
  };
  $('#pageHeadlineInput').value = words.headline || '';
  $('#pageNoteInput').value = words.note || '';
  openSheet('pageWordsSheet');
});
$('#clearPageWords').addEventListener('click', () => {
  $('#pageHeadlineInput').value = '';
  $('#pageNoteInput').value = '';
});
$('#savePageWords').addEventListener('click', () => {
  const journal = currentJournal();
  const pageKey = String(journal.page);
  const nextWords = {
    headline: $('#pageHeadlineInput').value.trim(),
    note: $('#pageNoteInput').value.trim()
  };
  journal.pageWords = { ...(journal.pageWords || {}), [pageKey]: nextWords };
  closeSheets();
  $('.canvas-line-one').textContent = nextWords.headline;
  $('.canvas-line-two').textContent = nextWords.note;
  $('.canvas-line-one').classList.toggle('is-empty', !nextWords.headline);
  $('.canvas-line-two').classList.toggle('is-empty', !nextWords.note);
  saveApp();
  showToast('Page words saved.');
});

function renderPrompt() {
  $('#dailyPrompt').textContent = journalPrompts[promptIndex];
}
$('#shufflePrompt').addEventListener('click', () => {
  promptIndex = (promptIndex + 1) % journalPrompts.length;
  renderPrompt();
});
$('#usePrompt').addEventListener('click', () => {
  if (!journals.length) {
    openNewJournalSheet();
    return;
  }
  setScreen('journalScreen');
  openJournal(0);
  addJournalPage();
  const journal = currentJournal();
  journal.pageWords[journal.page] = { headline: journalPrompts[promptIndex], note: '' };
  renderPage();
  saveApp();
  showToast('A fresh prompted page is ready.');
});

async function initializeApp() {
  await loadApp();
  renderLibrary();
  renderJournalBooks();
  renderTray();
  renderCanvasDock();
}

initializeApp();

$('#sortButton').addEventListener('click', () => {
  const modes = ['recent', 'name', 'group'];
  stickerSortMode = modes[(modes.indexOf(stickerSortMode) + 1) % modes.length];
  $('#sortButton').innerHTML = `${stickerSortMode} <span>⌄</span>`;
  $('#sortButton').setAttribute('aria-label', `Sorted by ${stickerSortMode}. Change sticker sorting`);
  renderLibrary(false);
});

// Help stays available from the ? button without interrupting a first action.
