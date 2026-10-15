// Ortak yardımcılar: dosya adı temizleme, biçimlendirme, JSON ayıklama.
globalThis.VD_UTILS = (() => {
  function sanitizeFilename(name, maxLen = 120) {
    let s = String(name == null ? '' : name)
      .replace(/[\u0000-\u001F\u007F<>:"/\\|?*\u2028\u2029]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    s = s.replace(/^[.\s]+|[.\s]+$/g, '');
    if (s.length > maxLen) s = s.slice(0, maxLen).trim();
    return s || 'video';
  }

  function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    const out = i === 0 ? Math.round(v) : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
    return out + ' ' + units[i];
  }

  function formatSpeed(bytesPerSec) {
    if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '';
    return formatBytes(bytesPerSec) + '/s';
  }

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const two = (x) => String(x).padStart(2, '0');
    return h > 0 ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
  }

  function formatBitrate(bps) {
    if (!Number.isFinite(bps) || bps <= 0) return '';
    return bps >= 1e6 ? (bps / 1e6).toFixed(1) + ' Mbps' : Math.round(bps / 1000) + ' kbps';
  }

  // Dosya adı (klasörsüz, uzantısız): "Yazar - Başlık [kalite]"
  // Yardımcı (yt-dlp) indirmelerinde kullanılır; uzantıyı yt-dlp belirler.
  function buildName(input) {
    const parts = [];
    if (input.author) parts.push(input.author);
    if (input.title) parts.push(input.title);
    const base = sanitizeFilename(parts.join(' - '), 110);
    const tag = input.tag ? ' [' + sanitizeFilename(input.tag, 28) + ']' : '';
    return base + tag;
  }

  // Dosya adı (klasörsüz): "Yazar - Başlık [kalite].uzanti"
  // Alt klasör OLUŞTURULMAZ; dosya tarayıcının İndirilenler klasörüne iner.
  function buildFilename(input) {
    const ext = input.ext ? (String(input.ext).startsWith('.') ? input.ext : '.' + input.ext) : '.mp4';
    return buildName(input) + ext;
  }

  // Metin içinde "marker = {...};" gibi gömülü JSON nesnesini süslü parantez
  // dengelemesiyle (string kaçışlarını koruyarak) çıkarır.
  function extractBalancedJson(text, marker, fromIndex = 0) {
    if (typeof text !== 'string' || !marker) return null;
    const idx = text.indexOf(marker, fromIndex);
    if (idx === -1) return null;
    let i = idx + marker.length;
    while (i < text.length && text[i] !== '{') i++;
    if (i >= text.length) return null;
    const start = i;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  function parseEmbeddedJson(text, marker) {
    const raw = extractBalancedJson(text, marker);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // signatureCipher string'inden itag çıkarır (s=...&sp=sig&url=<encoded>).
  function parseItagFromCipher(cipher) {
    try {
      const enc = new URLSearchParams(cipher).get('url');
      if (!enc) return null;
      const u = new URL(enc);
      const itag = u.searchParams.get('itag');
      return itag == null ? null : Number(itag);
    } catch {
      return null;
    }
  }

  // googlevideo indirmelerinde range parametreleri tam dosyayı bozar; temizle.
  function stripRangeParams(rawUrl) {
    try {
      const u = new URL(rawUrl);
      u.searchParams.delete('range');
      u.searchParams.delete('rn');
      u.searchParams.delete('rbuf');
      return u.toString();
    } catch {
      return rawUrl;
    }
  }

  function isHttpUrl(u) {
    try {
      const x = new URL(u);
      return x.protocol === 'http:' || x.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function ensureArray(x) {
    if (x == null) return [];
    return Array.isArray(x) ? x : [x];
  }

  function uuid() {
    try {
      return crypto.randomUUID();
    } catch {
      return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
  }

  return {
    sanitizeFilename,
    formatBytes,
    formatSpeed,
    formatDuration,
    formatBitrate,
    buildName,
    buildFilename,
    extractBalancedJson,
    parseEmbeddedJson,
    parseItagFromCipher,
    stripRangeParams,
    isHttpUrl,
    ensureArray,
    uuid
  };
})();
