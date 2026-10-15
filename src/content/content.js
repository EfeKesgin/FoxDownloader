// İçerik betiği: platform yönlendirme, SPA gezinme takibi, mesaj köprüsü.
(() => {
  const P = globalThis.VD_PROTOCOL;
  const extractors = globalThis.VD.extractors || {};

  const host = location.hostname;
  let extractor = null;
  if (/(^|\.)youtube\.com$/.test(host)) extractor = extractors.youtube;
  else if (/(^|\.)tiktok\.com$/.test(host)) extractor = extractors.tiktok;
  else if (/(^|\.)(twitter|x)\.com$/.test(host)) extractor = extractors.twitter;
  if (!extractor) return;

  let currentKey = null;
  let pageFormatsCache = null;
  let cacheTime = 0;
  const CACHE_MS = 8000;

  function send(msg) {
    return chrome.runtime.sendMessage(msg).catch(() => null);
  }

  // ---- format yükleme ----

  async function loadFormats(force = false) {
    const ctx = extractor.getContext();
    if (!ctx) {
      throw Object.assign(new Error('Bu sayfada video bulunamadı'), {
        hint: 'Bir video sayfası açın.'
      });
    }
    const fresh = !force && pageFormatsCache && ctx.key === currentKey && Date.now() - cacheTime < CACHE_MS;
    if (fresh) return pageFormatsCache;

    const result = await extractor.getFormats(ctx);
    let formats = result.formats;

    if (extractor.mergeSniffed) {
      const sniffed = await send({ type: P.GET_SNIFFED });
      if (sniffed && sniffed.ok && Array.isArray(sniffed.urls) && sniffed.urls.length) {
        formats = extractor.mergeSniffed(formats, sniffed.urls);
      }
    }

    // Yardımcı (native host) durumu: kurulum zorunlu olduğu için arayüz
    // kurulu değilse indirme listesi yerine kurulum ekranı gösterir.
    let helper = null;
    try {
      const res = await send({ type: P.HELPER_STATUS, force });
      helper = (res && res.status) || null;
    } catch {
      helper = null;
    }

    pageFormatsCache = { info: result.info, formats, helper };
    cacheTime = Date.now();
    return pageFormatsCache;
  }

  // ---- gezinme takibi ----

  function checkNavigation() {
    const ctx = extractor.getContext();
    if (!ctx) {
      currentKey = null;
      pageFormatsCache = null;
      return;
    }
    if (ctx.key !== currentKey) {
      currentKey = ctx.key;
      pageFormatsCache = null;
      send({ type: P.TAB_VIDEO, videoId: ctx.videoId });
    }
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      // SPA geçişlerinde DOM güncellensin diye küçük gecikme
      setTimeout(checkNavigation, 350);
    }
  }, 600);

  // ---- sayfa içi indirme hattı (TikTok vb. hotlink korumalı CDN'ler) ----
  // fetch(cookie'li, sayfa bağlamı) → blob → same-origin <a download>.
  // Chrome'un indirme yöneticisi blob'u gerçek dosya olarak kaydeder.

  const activeDownloads = new Map(); // itemId -> AbortController

  function postProgress(id, received, total) {
    chrome.runtime.sendMessage({ type: P.DOWNLOAD_PROGRESS, id, received, total }).catch(() => {});
  }

  function postDone(id, ok, detail) {
    chrome.runtime.sendMessage({ type: P.DOWNLOAD_DONE, id, ok, detail }).catch(() => {});
  }

  function triggerAnchorDownload(blob, filename) {
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 120000);
  }

  async function runFrontendDownload(item) {
    const ctrl = new AbortController();
    activeDownloads.set(item.id, ctrl);
    try {
      const res = await fetch(item.url, { credentials: 'include', signal: ctrl.signal });
      if (!res.ok) {
        postDone(item.id, false, 'HTTP ' + res.status);
        return;
      }
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body ? res.body.getReader() : null;
      const chunks = [];
      let received = 0;
      let lastPost = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (Date.now() - lastPost > 700) {
            lastPost = Date.now();
            postProgress(item.id, received, total);
          }
        }
        postProgress(item.id, received, total);
      } else {
        const buf = await res.arrayBuffer();
        chunks.push(new Uint8Array(buf));
        received = buf.byteLength;
      }
      const mime = (res.headers.get('content-type') || 'video/mp4').split(';')[0];
      const blob = new Blob(chunks, { type: mime });
      const filename = String(item.filename || 'video.mp4').split('/').pop();
      triggerAnchorDownload(blob, filename);
      postDone(item.id, true, blob.size);
    } catch (err) {
      const aborted = ctrl.signal.aborted;
      postDone(item.id, false, aborted ? 'İPTAL_EDİLDİ' : String((err && err.message) || err));
    } finally {
      activeDownloads.delete(item.id);
    }
  }

  // ---- mesajlar ----

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return false;

    if (msg.type === P.GET_PAGE_FORMATS) {
      loadFormats(msg.force === true)
        .then((result) => sendResponse({ ok: true, ...result, key: currentKey }))
        .catch((err) =>
          sendResponse({
            ok: false,
            error: String((err && err.message) || err),
            hint: (err && err.hint) || null
          })
        );
      return true;
    }

    if (msg.type === P.DOWNLOAD_IN_PAGE) {
      if (!msg.item || !msg.item.id || !msg.item.url) {
        sendResponse({ ok: false, error: 'Eksik indirme bilgisi' });
        return false;
      }
      if (activeDownloads.has(msg.item.id)) {
        sendResponse({ ok: true, note: 'zaten-aktif' });
        return false;
      }
      runFrontendDownload(msg.item);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === P.DOWNLOAD_CANCEL_IN_PAGE) {
      const ctrl = activeDownloads.get(msg.id);
      if (ctrl) ctrl.abort();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  // ---- başlat ----

  send({ type: P.TAB_HELLO });

  let booted = false;
  const boot = () => {
    if (booted) return;
    booted = true;
    checkNavigation();
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }
  window.addEventListener('load', checkNavigation, { once: true });
})();
