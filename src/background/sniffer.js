// Sniffer: sayfada gerçekten oynatılan medya isteklerini (googlevideo, TikTok CDN,
// video.twimg.com) webRequest ile gözlemler. YouTube'da imza şifrelemesi (signatureCipher)
// yüzünden doğrudan indirilemeyen formatlar, oynatma sırasında yakalanan URL ile açılır.

const MAX_ENTRIES_PER_TAB = 60;
const TTL_MS = 15 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 1000;

const TRACK_URLS = [
  '*://*.googlevideo.com/*',
  '*://*.youtube.com/*',
  '*://*.tiktok.com/*',
  '*://*.tiktokcdn.com/*',
  '*://*.tiktokcdn-us.com/*',
  '*://*.tiktokcdn-eu.com/*',
  '*://*.tiktokv.com/*',
  '*://*.twimg.com/*',
  '*://*.twitter.com/*',
  '*://*.x.com/*'
];

const MEDIA_EXT_RE = /\.(mp4|m4v|webm|mov|m4a|mp3|aac|opus|ogg|flac|wav|ts|m4s)(\?|#|$)/i;

// tabId -> { videoId, entries: Map<key, entry>, saveTimer }
const buckets = new Map();

function getBucket(tabId, create = true) {
  let b = buckets.get(tabId);
  if (!b && create) {
    b = { videoId: null, entries: new Map(), saveTimer: null };
    buckets.set(tabId, b);
  }
  return b || null;
}

function isCandidate(details, url) {
  if (details.type === 'media') return true;
  if (url.includes('googlevideo.com/videoplayback')) return true;
  if (url.includes('/video/tos/')) return true;
  if (url.includes('video.twimg.com')) return true;
  if (MEDIA_EXT_RE.test(url)) return true;
  return false;
}

function makeEntry(details, rawUrl) {
  const U = globalThis.VD_UTILS;
  let url = rawUrl;
  let itag = null;
  let mime = null;
  let size = null;
  let key = url;

  try {
    const u = new URL(rawUrl);
    itag = u.searchParams.get('itag');
    mime = u.searchParams.get('mime') || null;
    const clen = u.searchParams.get('clen');
    if (clen && Number.isFinite(Number(clen))) size = Number(clen);

    if (itag != null || u.hostname.endsWith('googlevideo.com')) {
      url = U.stripRangeParams(rawUrl);
    }

    if (itag != null) key = 'yt:' + itag + ':' + (mime || '');
    else key = u.origin + u.pathname;
  } catch {
    // URL ayrıştırılamadıysa ham URL ile devam et
  }

  return {
    key,
    url,
    itag: itag == null ? null : Number(itag),
    mime,
    size,
    ts: Date.now()
  };
}

function handleRequest(details) {
  if (!details || details.tabId == null || details.tabId < 0) return;
  const initiator = details.initiator || '';
  // Kendi indirmelerimizi yeniden yakalamayalım.
  if (initiator.startsWith('chrome-extension://')) return;
  if (!isCandidate(details, details.url)) return;

  const bucket = getBucket(details.tabId);
  const entry = makeEntry(details, details.url);
  bucket.entries.set(entry.key, entry);

  if (bucket.entries.size > MAX_ENTRIES_PER_TAB) {
    const sorted = Array.from(bucket.entries.entries()).sort((a, b) => a[1].ts - b[1].ts);
    const removeCount = bucket.entries.size - MAX_ENTRIES_PER_TAB;
    for (let i = 0; i < removeCount; i++) bucket.entries.delete(sorted[i][0]);
  }

  scheduleSave(details.tabId);
}

function scheduleSave(tabId) {
  const bucket = getBucket(tabId, false);
  if (!bucket || bucket.saveTimer) return;
  bucket.saveTimer = setTimeout(() => {
    bucket.saveTimer = null;
    const entries = Array.from(bucket.entries.values());
    const payload = {};
    payload['sniff:' + tabId] = { videoId: bucket.videoId, entries };
    try {
      chrome.storage.session.set(payload);
    } catch {
      // storage.session yoksa sessizce geç
    }
  }, SAVE_DEBOUNCE_MS);
}

export function startSniffer() {
  chrome.webRequest.onBeforeRequest.addListener(handleRequest, { urls: TRACK_URLS }, []);
}

// Video değişiminde (SPA gezinmeleri) eski kayıtları temizler.
// Oynatma istekleri içerik betiğinden ~1 sn önce gelebileceği için
// son 1,5 saniyede yakalananlar korunur.
export async function noteTabVideo(tabId, videoId) {
  if (tabId == null || tabId < 0) return;
  const bucket = getBucket(tabId);
  if (bucket.videoId === videoId) return;
  const hadVideo = bucket.videoId != null;
  bucket.videoId = videoId;
  if (hadVideo) {
    const cutoff = Date.now() - 1500;
    for (const [key, entry] of bucket.entries) {
      if (entry.ts < cutoff) bucket.entries.delete(key);
    }
  }
  scheduleSave(tabId);
}

async function hydrate(tabId) {
  let bucket = buckets.get(tabId);
  if (bucket) return bucket;
  bucket = getBucket(tabId, true);
  try {
    const stored = await chrome.storage.session.get('sniff:' + tabId);
    const data = stored['sniff:' + tabId];
    if (data && Array.isArray(data.entries)) {
      bucket.videoId = data.videoId || null;
      for (const entry of data.entries) {
        if (entry && entry.key && entry.url) bucket.entries.set(entry.key, entry);
      }
    }
  } catch {
    // yoksay
  }
  return bucket;
}

export async function getSniffed(tabId) {
  if (tabId == null || tabId < 0) return [];
  const bucket = await hydrate(tabId);
  const now = Date.now();
  const out = [];
  for (const [key, entry] of bucket.entries) {
    if (now - entry.ts > TTL_MS) {
      bucket.entries.delete(key);
      continue;
    }
    out.push({ url: entry.url, itag: entry.itag, mime: entry.mime, size: entry.size, ts: entry.ts });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

export function dropTab(tabId) {
  const bucket = buckets.get(tabId);
  if (bucket && bucket.saveTimer) clearTimeout(bucket.saveTimer);
  buckets.delete(tabId);
  try {
    chrome.storage.session.remove('sniff:' + tabId);
  } catch {
    // yoksay
  }
}
