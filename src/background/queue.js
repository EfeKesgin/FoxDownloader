// İndirme kuyruğu: chrome.downloads üzerinde eşzamanlılık, ilerleme, hız,
// otomatik devam etme (resume) ve kalıcılık yönetimi.

import {
  startDownload as helperStartDownload,
  cancelDownload as helperCancelDownload,
  reveal as helperReveal,
  onHelperEvent
} from './helper.js';

const STORAGE_QUEUE = 'vd_queue';
const STORAGE_SETTINGS = 'vd_settings';
const MAX_ITEMS = 200;
const EMIT_THROTTLE_MS = 400;
const SAVE_DEBOUNCE_MS = 300;
const DEFAULT_SETTINGS = { concurrency: 3, autoRetry: true, helperDir: '', helperCookies: '' };

const U = () => globalThis.VD_UTILS;
const P = () => globalThis.VD_PROTOCOL;

let items = [];
let settings = { ...DEFAULT_SETTINGS };
let loadPromise = null;
let emitTimer = null;
let saveTimer = null;
let pumping = false;
const subscribers = new Set();

// ---------- kalıcılık ----------

async function load() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const stored = await chrome.storage.local.get([STORAGE_QUEUE, STORAGE_SETTINGS]);
      if (Array.isArray(stored[STORAGE_QUEUE])) {
        items = stored[STORAGE_QUEUE].filter((i) => i && i.url);
      }
      if (stored[STORAGE_SETTINGS] && typeof stored[STORAGE_SETTINGS] === 'object') {
        settings = { ...DEFAULT_SETTINGS, ...stored[STORAGE_SETTINGS] };
      }
    } catch {
      // yoksay
    }
    await resyncActive();
  })();
  return loadPromise;
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const payload = {};
    payload[STORAGE_QUEUE] = items.map(publicItem);
    payload[STORAGE_SETTINGS] = settings;
    chrome.storage.local.set(payload).catch(() => {});
  }, SAVE_DEBOUNCE_MS);
}

// Tarayıcı eklentisi yeniden başladığında devam eden indirmelerin durumunu eşitle.
async function resyncActive() {
  // Yardımcı (yt-dlp) indirmeleri service worker ömrüne bağlıdır: tarayıcı ya da
  // worker yeniden başladıysa yardımcı süreç kapanmıştır → yeniden kuyruğa al
  // (yt-dlp .part dosyasından devam eder).
  for (const item of items) {
    if (item.via === 'helper' && (item.state === 'downloading' || item.state === 'starting')) {
      item.state = 'queued';
      item.speed = 0;
      item.error = null;
    }
  }

  // Sayfa içi (frontend) indirmeleri 2 dakikadan uzun süredir ilerleme bildirmediyse
  // yarım kalmış say (sekme kapanmış/yenilenmiş olabilir).
  const now = Date.now();
  for (const item of items) {
    if (item.state === 'fetching' && now - (item.lastProgressAt || item.startedAt || item.addedAt) > 120000) {
      item.state = 'error';
      item.error = 'YARIM_KALDI (sekme kapanmış olabilir)';
      item.finishedAt = now;
    }
  }

  const active = items.filter((i) => i.downloadId != null && (i.state === 'downloading' || i.state === 'starting' || i.state === 'paused'));
  if (!active.length) return;
  try {
    const found = await chrome.downloads.search({ id: active.map((i) => i.downloadId) });
    const byId = new Map(found.map((d) => [d.id, d]));
    for (const item of active) {
      const d = byId.get(item.downloadId);
      if (!d) {
        item.state = 'error';
        item.error = 'DOWNLOAD_NOT_FOUND';
        item.downloadId = null;
        continue;
      }
      if (d.totalBytes > 0) item.totalBytes = d.totalBytes;
      if (d.bytesReceived > 0) item.bytesReceived = d.bytesReceived;
      item.paused = !!d.paused;
      if (d.state === 'complete') {
        item.state = 'complete';
        item.finishedAt = item.finishedAt || Date.now();
      } else if (d.state === 'interrupted') {
        item.state = 'error';
        item.error = d.error || 'INTERRUPTED';
      } else {
        item.state = d.paused ? 'paused' : 'downloading';
      }
    }
  } catch {
    // yoksay
  }
}

// ---------- dışa aktarma / yayın ----------

function publicItem(item) {
  const out = { ...item };
  delete out._sample;
  return out;
}

function snapshot() {
  return {
    queue: items.map(publicItem),
    settings: { ...settings }
  };
}

function emitNow() {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
  const payload = { type: P().QUEUE_UPDATE, ...snapshot() };
  try {
    chrome.runtime.sendMessage(payload).catch(() => {});
  } catch {
    // açık alıcı yok
  }
  for (const fn of subscribers) {
    try {
      fn(payload);
    } catch {
      // yoksay
    }
  }
}

function emitSoon() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    emitNow();
  }, EMIT_THROTTLE_MS);
}

export function onQueueUpdate(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// ---------- hız örnekleme ----------

function sampleSpeed(item) {
  const now = Date.now();
  const prev = item._sample;
  if (!prev) {
    item._sample = { t: now, b: item.bytesReceived || 0 };
    return;
  }
  const dt = (now - prev.t) / 1000;
  if (dt < 0.4) return;
  const inst = Math.max(0, ((item.bytesReceived || 0) - prev.b) / dt);
  item.speed = item.speed ? item.speed * 0.6 + inst * 0.4 : inst;
  item._sample = { t: now, b: item.bytesReceived || 0 };
}

// ---------- kuyruk motoru ----------

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    const activeCount = items.filter(
      (i) => i.state === 'downloading' || i.state === 'starting' || i.state === 'fetching'
    ).length;
    let slots = Math.max(1, Number(settings.concurrency) || 3) - activeCount;
    if (slots <= 0) return;
    const queued = items.filter((i) => i.state === 'queued');
    for (const item of queued) {
      if (slots <= 0) break;
      slots--;
      startItem(item);
    }
  } finally {
    pumping = false;
  }
}

async function startItem(item) {
  item.error = null;
  item.speed = 0;
  item._sample = null;
  if (item.via === 'frontend') {
    startFrontendItem(item);
    return;
  }
  if (item.via === 'helper') {
    startHelperItem(item);
    return;
  }
  item.state = 'starting';
  emitSoon();
  try {
    const downloadId = await chrome.downloads.download({
      url: item.url,
      filename: item.filename || undefined,
      conflictAction: 'uniquify',
      saveAs: false
    });
    item.downloadId = downloadId;
    item.state = 'downloading';
    item.startedAt = item.startedAt || Date.now();
  } catch (err) {
    item.state = 'error';
    item.error = String((err && err.message) || err || 'DOWNLOAD_FAILED');
    item.finishedAt = Date.now();
    item.downloadId = null;
  }
  save();
  emitSoon();
  pump();
}

// Sayfa içi indirme: içerik betiği fetch(cookie'li) → blob → same-origin <a download>.
// TikTok gibi hotlink korumalı CDN'lerde chrome.downloads 403 yerken bu hat çalışır.
async function startFrontendItem(item) {
  if (item.tabId == null) {
    item.state = 'error';
    item.error = 'SEKME_BILGISI_YOK';
    item.finishedAt = Date.now();
    save();
    emitNow();
    pump();
    return;
  }
  item.state = 'fetching';
  item.startedAt = item.startedAt || Date.now();
  item.lastProgressAt = Date.now();
  save();
  emitSoon();
  try {
    const res = await chrome.tabs.sendMessage(item.tabId, {
      type: P().DOWNLOAD_IN_PAGE,
      item: { id: item.id, url: item.url, filename: item.filename }
    });
    if (!res || !res.ok) {
      item.state = 'error';
      item.error = (res && res.error) || 'SAYFAYA_ULASILAMADI';
      item.finishedAt = Date.now();
      save();
      emitNow();
      pump();
    }
  } catch {
    item.state = 'error';
    item.error = 'SEKME_KAPALI (videoyu yeniden açıp Tekrar deneyin)';
    item.finishedAt = Date.now();
    save();
    emitNow();
    pump();
  }
}

// Yardımcı (yt-dlp) indirmesi: native messaging host'u üzerinden yt-dlp.exe çalışır.
// İlerleme/hız olayları doğrudan yt-dlp'den gelir (sampleSpeed gerekmez).
async function startHelperItem(item) {
  item.state = 'downloading';
  item.startedAt = item.startedAt || Date.now();
  item.lastProgressAt = Date.now();
  item.error = null;
  item.dir = settings.helperDir || '';
  save();
  emitSoon();
  try {
    await helperStartDownload({
      id: item.id,
      selector: item.selector || 'bv*+ba/b',
      url: item.url,
      name: item.filename || 'video',
      dir: settings.helperDir || '',
      cookies: settings.helperCookies || ''
    });
  } catch (err) {
    if (item.state === 'canceled') {
      pump();
      return;
    }
    const code = String((err && err.message) || err || 'YARDIMCI_HATASI');
    item.state = 'error';
    item.error =
      code === 'YARDIMCI_KURULU_DEGIL'
        ? 'YARDIMCI_KURULU_DEGIL (Ayarlar → YouTube Yardımcısı)'
        : code === 'YT_DLP_YOK'
          ? 'YT_DLP_YOK (kurulumu yeniden çalıştırın)'
          : code;
    item.finishedAt = Date.now();
    item.speed = 0;
    save();
    emitNow();
    pump();
  }
}

function helperItemById(id) {
  return items.find((i) => i.id === id);
}

function helperProgress(event) {
  const item = helperItemById(event.id);
  if (!item || item.via !== 'helper') return;
  if (item.state !== 'downloading' && item.state !== 'starting' && item.state !== 'queued') return;
  item.state = 'downloading';
  item.bytesReceived = Math.max(0, event.d || 0);
  if (event.t > 0) item.totalBytes = event.t;
  if (event.s > 0) item.speed = event.s;
  item.lastProgressAt = Date.now();
  save();
  emitSoon();
}

function helperFinished(event) {
  const item = helperItemById(event.id);
  if (!item || item.via !== 'helper') return;
  if (item.state === 'canceled') {
    pump();
    return;
  }
  item.state = 'complete';
  item.finishedAt = Date.now();
  item.speed = 0;
  if (event.file) item.filePath = event.file;
  if (event.bytes > 0) {
    item.bytesReceived = event.bytes;
    if (!item.totalBytes) item.totalBytes = event.bytes;
  }
  save();
  emitNow();
  pump();
}

function helperFailed(event) {
  const item = helperItemById(event.id);
  if (!item || item.via !== 'helper') return;
  if (item.state === 'canceled') {
    pump();
    return;
  }
  item.state = 'error';
  item.error = String(event.error || 'YARDIMCI_HATASI').slice(0, 400);
  item.finishedAt = Date.now();
  item.speed = 0;
  save();
  emitNow();
  pump();
}

async function handleHelperEvent(event) {
  if (!event || !event.id) return;
  await load();
  if (event.ev === 'p') helperProgress(event);
  else if (event.ev === 'done') helperFinished(event);
  else if (event.ev === 'err') helperFailed(event);
}

onHelperEvent(handleHelperEvent);

// İçerik betiğinden ilerleme/bitti bildirimleri
export async function frontendProgress(id, received, total) {
  await load();
  const item = items.find((i) => i.id === id);
  if (!item || item.state !== 'fetching') return;
  item.bytesReceived = Math.max(0, Number(received) || 0);
  if (Number(total) > 0) item.totalBytes = Number(total);
  item.lastProgressAt = Date.now();
  sampleSpeed(item);
  save();
  emitSoon();
}

export async function frontendDone(id, ok, detail) {
  await load();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  if (item.state === 'canceled') {
    pump();
    return;
  }
  if (ok) {
    item.state = 'complete';
    item.finishedAt = Date.now();
    item.speed = 0;
    if (Number(detail) > 0) {
      item.bytesReceived = Number(detail);
      if (!item.totalBytes) item.totalBytes = Number(detail);
    }
  } else {
    item.state = 'error';
    item.error = String(detail || 'INDIRME_BASARISIZ');
    item.finishedAt = Date.now();
    item.speed = 0;
  }
  save();
  emitNow();
  pump();
}

function handleInterrupted(item) {
  if (item.error === 'USER_CANCELED') {
    item.state = 'canceled';
    item.finishedAt = Date.now();
    return;
  }
  const retries = item.retries || 0;
  if (settings.autoRetry && retries < 1 && item.downloadId != null) {
    item.retries = retries + 1;
    chrome.downloads
      .resume(item.downloadId)
      .then(() => {
        item.state = 'downloading';
        save();
        emitSoon();
      })
      .catch(() => {
        // devam ettirilemedi: sıfırdan yeniden dene
        item.downloadId = null;
        item.state = 'queued';
        item.bytesReceived = 0;
        save();
        emitSoon();
        pump();
      });
    return;
  }
  item.state = 'error';
  item.error = item.error || 'INTERRUPTED';
  item.finishedAt = Date.now();
}

function attachDownloadListeners() {
  chrome.downloads.onChanged.addListener((delta) => {
    const item = items.find((i) => i.downloadId === delta.id);
    if (!item) return;
    let structural = false;

    if (delta.bytesReceived) {
      item.bytesReceived = delta.bytesReceived.current || 0;
      sampleSpeed(item);
    }
    if (delta.totalBytes && delta.totalBytes.current > 0) {
      item.totalBytes = delta.totalBytes.current;
    }
    if (delta.paused) {
      item.paused = !!delta.paused.current;
      if (item.state === 'downloading' || item.state === 'paused') {
        item.state = item.paused ? 'paused' : 'downloading';
      }
    }
    if (delta.error && delta.error.current) {
      item.error = delta.error.current;
    }
    if (delta.state) {
      const s = delta.state.current;
      if (s === 'complete') {
        item.state = 'complete';
        item.finishedAt = Date.now();
        item.speed = 0;
        item.paused = false;
        if (item.totalBytes) item.bytesReceived = item.totalBytes;
        structural = true;
      } else if (s === 'interrupted') {
        handleInterrupted(item);
        structural = true;
      } else if (s === 'in_progress') {
        if (item.state !== 'downloading' && !item.paused) {
          item.state = 'downloading';
          item.startedAt = item.startedAt || Date.now();
        }
      }
    }

    save();
    if (structural) {
      emitNow();
      pump();
    } else {
      emitSoon();
    }
  });

  chrome.downloads.onErased.addListener((downloadId) => {
    const item = items.find((i) => i.downloadId === downloadId);
    if (!item) return;
    if (item.state === 'downloading' || item.state === 'starting' || item.state === 'paused') {
      item.state = 'canceled';
      item.finishedAt = Date.now();
      item.downloadId = null;
      save();
      emitNow();
      pump();
    }
  });
}

export async function initQueue() {
  await load();
  attachDownloadListeners();
  pump();
  emitNow();
}

// ---------- genel API ----------

export async function enqueue(input) {
  await load();
  const Uu = U();
  if (!input || !Uu.isHttpUrl(input.url)) {
    throw new Error('Geçersiz medya adresi');
  }
  const item = {
    id: Uu.uuid(),
    url: input.url,
    filename: input.filename || null,
    platform: input.platform || 'Video',
    title: input.title || '',
    author: input.author || '',
    quality: input.quality || '',
    size: Number.isFinite(input.size) ? input.size : null,
    via: input.via === 'frontend' ? 'frontend' : input.via === 'helper' ? 'helper' : 'native',
    selector: input.via === 'helper' ? String(input.selector || 'bv*+ba/b').slice(0, 300) : null,
    filePath: null,
    dir: null,
    tabId: Number.isInteger(input.tabId) ? input.tabId : null,
    state: 'queued',
    downloadId: null,
    bytesReceived: 0,
    totalBytes: Number.isFinite(input.size) ? input.size : null,
    speed: 0,
    paused: false,
    error: null,
    retries: 0,
    addedAt: Date.now(),
    startedAt: null,
    finishedAt: null
  };
  items.unshift(item);

  if (items.length > MAX_ITEMS) {
    const removable = items
      .filter((i) => i.state === 'complete' || i.state === 'canceled' || i.state === 'error')
      .sort((a, b) => a.addedAt - b.addedAt);
    while (items.length > MAX_ITEMS && removable.length) {
      const victim = removable.shift();
      items = items.filter((i) => i !== victim);
    }
  }

  save();
  emitNow();
  pump();
  return item.id;
}

export async function getSnapshot() {
  await load();
  return snapshot();
}

export async function setSettings(patch) {
  await load();
  if (patch && typeof patch === 'object') {
    if (Number.isFinite(patch.concurrency)) {
      settings.concurrency = Math.min(5, Math.max(1, Math.round(patch.concurrency)));
    }
    if (typeof patch.autoRetry === 'boolean') settings.autoRetry = patch.autoRetry;
    if (typeof patch.helperDir === 'string') settings.helperDir = patch.helperDir.trim().slice(0, 300);
    if (typeof patch.helperCookies === 'string') {
      const allowed = ['', 'brave', 'chrome', 'chromium', 'edge', 'opera', 'firefox', 'vivaldi'];
      if (allowed.includes(patch.helperCookies)) settings.helperCookies = patch.helperCookies;
    }
  }
  save();
  emitNow();
  pump();
  return { ...settings };
}

export async function pauseItem(id) {
  await load();
  const item = items.find((i) => i.id === id);
  if (!item || item.downloadId == null) return;
  if (item.via !== 'native') return;
  try {
    await chrome.downloads.pause(item.downloadId);
    item.paused = true;
    if (item.state === 'downloading' || item.state === 'starting') item.state = 'paused';
    save();
    emitNow();
  } catch {
    // yoksay
  }
}

export async function resumeItem(id) {
  await load();
  const item = items.find((i) => i.id === id);
  if (!item || item.downloadId == null) return;
  try {
    await chrome.downloads.resume(item.downloadId);
    item.paused = false;
    item.state = 'downloading';
    save();
    emitNow();
  } catch {
    // yoksay
  }
}

export async function cancelItem(id) {
  await load();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  if (item.via === 'helper' && (item.state === 'downloading' || item.state === 'starting')) {
    helperCancelDownload(item.id);
  }
  if (item.via === 'frontend' && item.tabId != null && item.state === 'fetching') {
    chrome.tabs
      .sendMessage(item.tabId, { type: P().DOWNLOAD_CANCEL_IN_PAGE, id: item.id })
      .catch(() => {});
  }
  if (item.downloadId != null) {
    try {
      await chrome.downloads.cancel(item.downloadId);
    } catch {
      // yoksay
    }
    try {
      await chrome.downloads.erase({ id: item.downloadId });
    } catch {
      // yoksay
    }
  }
  item.state = 'canceled';
  item.finishedAt = Date.now();
  item.downloadId = null;
  item.speed = 0;
  save();
  emitNow();
  pump();
}

export async function removeItem(id) {
  await load();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  if (item.via === 'helper' && (item.state === 'downloading' || item.state === 'starting')) {
    helperCancelDownload(item.id);
  }
  if (item.via === 'frontend' && item.tabId != null && item.state === 'fetching') {
    chrome.tabs
      .sendMessage(item.tabId, { type: P().DOWNLOAD_CANCEL_IN_PAGE, id: item.id })
      .catch(() => {});
  }
  if (item.downloadId != null && (item.state === 'downloading' || item.state === 'starting' || item.state === 'paused')) {
    try {
      await chrome.downloads.cancel(item.downloadId);
    } catch {
      // yoksay
    }
  }
  items = items.filter((i) => i.id !== id);
  save();
  emitNow();
  pump();
}

export async function retryItem(id) {
  await load();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  if (item.state === 'complete' || item.state === 'downloading' || item.state === 'starting') return;
  item.state = 'queued';
  item.error = null;
  item.paused = false;
  item.retries = 0;
  item.bytesReceived = 0;
  item.speed = 0;
  item.downloadId = null;
  if (item.via !== 'helper') item.filePath = null;
  save();
  emitNow();
  pump();
}

// Tamamlanan dosyanın klasörünü dümdüz açar (dosya seçmez, ağaç uzatmaz).
// Önce yardımcı denenir; dosya/klasör yolu bilinmiyorsa indirmenin kayıtlı
// adresi chrome.downloads'tan sorulur.
export async function revealItem(id) {
  await load();
  const item = items.find((i) => i.id === id);
  if (!item) return false;
  const known = item.filePath || item.dir;
  if (known && (await helperReveal(known))) return true;
  if (item.downloadId != null) {
    try {
      const found = await chrome.downloads.search({ id: item.downloadId });
      const file = found && found[0] && found[0].filename;
      if (file && (await helperReveal(file))) return true;
    } catch {
      // yoksay
    }
    try {
      chrome.downloads.show(item.downloadId);
      return true;
    } catch {
      // yoksay
    }
  }
  return false;
}

export async function clearFinished() {
  await load();
  items = items.filter((i) => i.state !== 'complete' && i.state !== 'canceled' && i.state !== 'error');
  save();
  emitNow();
}
