// X (Twitter) çıkarıcı: sendikasyon API'sinden video varyantlarını alır.
globalThis.VD = globalThis.VD || {};
globalThis.VD.extractors = globalThis.VD.extractors || {};

globalThis.VD.extractors.twitter = (() => {
  const U = globalThis.VD_UTILS;
  const P = globalThis.VD_PROTOCOL;
  const PLATFORM = 'X (Twitter)';

  function getContext(url = location.href) {
    try {
      const u = new URL(url);
      if (!/(^|\.)(twitter|x)\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      if (!m) return null;
      return {
        platform: PLATFORM,
        tweetId: m[2],
        screenName: m[1],
        videoId: m[2],
        key: 'tw:' + m[2]
      };
    } catch {
      return null;
    }
  }

  // DOM'da varsa doğrudan mp4 kaynağı (yedek yol).
  function domVideoSources() {
    const out = [];
    for (const v of document.querySelectorAll('video')) {
      const src = v.currentSrc || v.src || '';
      if (/^https?:\/\//.test(src) && !src.startsWith('blob:')) out.push(src);
      for (const s of v.querySelectorAll('source')) {
        if (s.src && /^https?:\/\//.test(s.src)) out.push(s.src);
      }
    }
    return out;
  }

  function titleFromDom() {
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return og.content.replace(/^.+? on (X|Twitter):\s*/i, '').replace(/\s*\/\s*X\s*$/, '');
    return document.title.replace(/\s*\/\s*X\s*$/, '');
  }

  async function getFormats(ctx) {
    const info = {
      platform: PLATFORM,
      title: titleFromDom() || 'X videosu',
      author: ctx.screenName || '',
      duration: 0,
      videoId: ctx.tweetId
    };

    let variants = [];
    try {
      const res = await chrome.runtime.sendMessage({ type: P.FETCH_TWEET_MEDIA, tweetId: ctx.tweetId });
      if (res && res.ok) {
        variants = res.variants || [];
        if (res.text) info.title = res.text.trim().slice(0, 140) || info.title;
        if (res.screenName) info.author = res.screenName;
      }
    } catch {
      // DOM yoluna düş
    }

    const formats = [];
    const seen = new Set();
    for (const v of variants) {
      if (!v.url || seen.has(v.url)) continue;
      seen.add(v.url);
      const mbps = (Number(v.bitrate) || 0) / 1e6;
      const tag = mbps ? mbps.toFixed(1) + 'mbps' : 'video';
      const dims = String(v.url).match(/\/(\d{2,4})x(\d{2,4})\//);
      const height = dims ? Math.min(Number(dims[1]), Number(dims[2])) : 0;
      formats.push({
        id: 'tw-' + formats.length,
        kind: 'video',
        label: (height ? height + 'p MP4' : 'MP4') + ' • ' + (mbps ? U.formatBitrate(v.bitrate) : 'kalite bilinmiyor'),
        tag: height ? height + 'p' : tag,
        height,
        ext: 'mp4',
        bitrate: Number(v.bitrate) || 0,
        sortKey: (height || 0) * 1e9 + (Number(v.bitrate) || 0),
        size: null,
        url: v.url
      });
    }

    if (!formats.length) {
      const dom = domVideoSources();
      dom.forEach((url, i) => {
        if (seen.has(url)) return;
        seen.add(url);
        formats.push({
          id: 'tw-dom-' + i,
          kind: 'video',
          label: 'MP4 • sayfadan alındı',
          tag: 'video',
          height: 0,
          ext: 'mp4',
          bitrate: 0,
          sortKey: 0,
          size: null,
          url
        });
      });
    }

    if (!formats.length) {
      throw Object.assign(new Error('Bu gönderide indirilebilir video bulunamadı'), {
        hint: 'Video içeren bir gönderi açtığınızdan emin olun.'
      });
    }

    formats.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));

    // Yardımcı kuruluysa doğrudan MP4 adresleri de yardımcıyla iner: chrome.downloads
    // tarayıcının "her dosyada nereye kaydedileceğini sor" ayarına uyar ve pencere açar;
    // yardımcı ise sormadan seçili indirme klasörüne kaydeder.
    if (await helperReady()) {
      for (const f of formats) {
        f.kind = 'helper-video';
        f.via = 'helper';
        f.selector = 'b';
      }
    }
    return { info, formats };
  }

  async function helperReady() {
    try {
      const res = await chrome.runtime.sendMessage({ type: P.HELPER_STATUS });
      const st = res && res.status;
      return !!(st && st.ok && st.ytdlp);
    } catch {
      return false;
    }
  }

  return { platform: PLATFORM, getContext, getFormats };
})();
