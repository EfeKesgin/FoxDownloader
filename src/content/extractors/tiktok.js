// TikTok çıkarıcı: video verisini gömülü JSON'dan okur. Akışta (FYP) video
// kimliği adreste yoktur; oynatıcı sarmalayıcısından (xgwrapper-0-...) çıkarılır.
globalThis.VD = globalThis.VD || {};
globalThis.VD.extractors = globalThis.VD.extractors || {};

globalThis.VD.extractors.tiktok = (() => {
  const U = globalThis.VD_UTILS;
  const P = globalThis.VD_PROTOCOL;
  const PLATFORM = 'TikTok';

  // Video bağlamı: önce adresten (normal video sayfası ya da ?modal_id=...)
  // çözülür. TikTok akış sayfalarında (/foryou) adreste video kimliği
  // bulunmaz; bu durumda o an oynayan/görünen akış kartından okunur.
  function contextFromUrl(url = location.href) {
    try {
      const u = new URL(url);
      if (!/(^|\.)tiktok\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/\/@([^/]+)\/(?:video|photo)\/(\d+)/);
      if (m) {
        return {
          platform: PLATFORM,
          videoId: m[2],
          author: m[1],
          key: 'tt:' + m[2]
        };
      }
      const modal = u.searchParams.get('modal_id');
      if (modal && /^\d{6,}$/.test(modal)) {
        return {
          platform: PLATFORM,
          videoId: modal,
          author: '',
          key: 'tt:' + modal
        };
      }
    } catch {
      // yoksay
    }
    return null;
  }

  // Akış/grid sayfalarında o an oynayan (yoksa ekranın ortasındaki) videonun
  // kartını bulur. TikTok akışta /video/ bağlantısı üretmez; kimlik oynatıcı
  // sarmalayıcısının id'sinde durur: "xgwrapper-0-<videoId>". Yazar ise
  // kartın /@kullanıcı bağlantısından alınır (yazarsız indirme adresi
  // kurulamaz, yt-dlp 404 verir).
  function contextFromFeed() {
    if (!/(^|\.)tiktok\.com$/.test(location.hostname)) return null;
    const vids = document.querySelectorAll('video');
    const mid = (window.innerHeight || 800) / 2;
    let best = null;
    let bestScore = Infinity;
    for (const v of vids) {
      const r = v.getBoundingClientRect();
      if (r.width < 120 || r.height < 120) continue;
      const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (visible < 120) continue;
      let score = Math.abs(r.top + r.height / 2 - mid);
      if (!v.paused) score -= 1e7; // oynayan video öncelikli
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    if (!best) return null;

    // Kimlik, oynatıcı sarmalayıcısının id'sinde (xgwrapper-0-...); yazar
    // bağlantısı ise kart kapsayıcısında (recommend-list-item-container).
    const wrapEl = best.closest('[id^="xgwrapper-0-"]');
    const card = best.closest('[data-e2e="recommend-list-item-container"]') || wrapEl;
    if (!card) return null;

    let videoId = '';
    if (wrapEl) {
      const m = String(wrapEl.id).match(/(\d{10,})$/);
      if (m) videoId = m[1];
    }
    if (!videoId) {
      const el = card.querySelector('[id^="xgwrapper-0-"]');
      if (el) {
        const m = String(el.id).match(/(\d{10,})$/);
        if (m) videoId = m[1];
      }
    }
    if (!videoId) {
      const menu = card.querySelector('[data-more-menu-item-id]');
      const m = menu && String(menu.getAttribute('data-more-menu-item-id')).match(/\d{10,}/);
      if (m) videoId = m[0];
    }
    if (!videoId) return null;

    let author = '';
    for (const a of card.querySelectorAll('a[href^="/@"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/@([A-Za-z0-9._-]+)/);
      if (m && m[1]) {
        author = m[1];
        break;
      }
    }
    if (!author) return null;

    return { platform: PLATFORM, videoId, author, key: 'tt:' + videoId };
  }

  function getContext(url) {
    const fromUrl = contextFromUrl(url);
    if (fromUrl && fromUrl.author) return fromUrl;
    // Dışarıdan belirli bir adres sorulduysa akış DOM'una bakma.
    if (typeof url === 'string' && url) return fromUrl;
    return contextFromFeed() || fromUrl;
  }

  function universalDataFromDom() {
    const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (el && el.textContent) {
      try {
        return JSON.parse(el.textContent);
      } catch {
        // devam
      }
    }
    return null;
  }

  async function universalDataFor(ctx) {
    const dom = universalDataFromDom();
    const item = itemStructFrom(dom);
    if (item && String(item.id) === String(ctx.videoId)) return item;

    // Yazar bilgisi olmadan geçerli bir izleme adresi kurulamaz.
    if (!ctx.author) return item;

    // SPA gezinmelerinde gömülü veri bayat kalabilir: sayfayı arka planda çek.
    try {
      const res = await chrome.runtime.sendMessage({
        type: P.FETCH_PAGE,
        url: 'https://www.tiktok.com/@' + encodeURIComponent(ctx.author || '') + '/video/' + ctx.videoId
      });
      if (res && res.ok && res.html) {
        const m = res.html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
        if (m) {
          const data = JSON.parse(m[1]);
          const fetched = itemStructFrom(data);
          if (fetched) return fetched;
        }
      }
    } catch {
      // yoksay
    }
    return item;
  }

  function itemStructFrom(data) {
    try {
      const scope = data && data.__DEFAULT_SCOPE__;
      if (!scope) return null;
      const detail = scope['webapp.video-detail'];
      if (detail && detail.itemInfo && detail.itemInfo.itemStruct) return detail.itemInfo.itemStruct;
      // bazı sayfa türlerinde farklı anahtar
      for (const key of Object.keys(scope)) {
        const node = scope[key];
        if (node && node.itemInfo && node.itemInfo.itemStruct) return node.itemInfo.itemStruct;
      }
    } catch {
      // yoksay
    }
    return null;
  }

  function heightFromQualityType(q) {
    if (!q) return 0;
    const m = String(q).match(/(\d{3,4})/);
    return m ? Number(m[1]) : 0;
  }

  // ---------- Yardımcı (yt-dlp) ----------
  // TikTok videoları yardımcı ile filigransız MP4 olarak iner. Sayfa içi
  // (frontend) satırlar TikTok CDN'inin hotlink koruması yüzünden bazı
  // videolarda hata verebilir; bu yüzden yardımcı satırları listenin başındadır.

  async function getHelperStatus() {
    try {
      const res = await chrome.runtime.sendMessage({ type: P.HELPER_STATUS });
      return (res && res.status) || null;
    } catch {
      return null;
    }
  }

  function helperFormats(status, watchUrl) {
    if (!status || !status.ok || !status.ytdlp) return [];
    return [
      {
        id: 'tt-helper-video',
        kind: 'helper-video',
        label: 'En iyi kalite (Yardımcı • MP4, filigransız)',
        tag: 'video',
        ext: 'mp4',
        height: 0,
        url: watchUrl,
        via: 'helper',
        selector: 'b[vcodec^=h264]/b[ext=mp4]/b',
        disabled: false,
        note: null
      },
      {
        id: 'tt-helper-audio',
        kind: 'helper-audio',
        label: 'Ses (Yardımcı • MP3)',
        tag: 'ses',
        ext: 'mp3',
        height: 0,
        url: watchUrl,
        via: 'helper',
        selector: 'audio',
        disabled: false,
        note: null
      }
    ];
  }

  async function getFormats(ctx) {
    const watchUrl = ctx.author
      ? 'https://www.tiktok.com/@' + encodeURIComponent(ctx.author) + '/video/' + ctx.videoId
      : '';
    const helperStatus = await getHelperStatus();
    const helperRows = watchUrl ? helperFormats(helperStatus, watchUrl) : [];

    const info = {
      platform: PLATFORM,
      title: 'TikTok video',
      author: ctx.author || '',
      duration: 0,
      videoId: ctx.videoId,
      helper: {
        installed: !!(helperStatus && helperStatus.ok && helperStatus.ytdlp),
        ffmpeg: !!(helperStatus && helperStatus.ffmpeg),
        dir: (helperStatus && helperStatus.dir) || ''
      }
    };

    const formats = [];
    let domError = null;

    // Sayfadaki gömülü veriden tarayıcı içi indirme satırları (bulunabilirse).
    const item = await universalDataFor(ctx);
    if (item) {
      const video = item.video || {};
      info.title = (item.desc || '').trim() || 'TikTok video';
      info.author = (item.author && item.author.uniqueId) || ctx.author || '';
      info.duration = Number(video.duration) || 0;

      const seen = new Set();
      const push = (f) => {
        if (!f.url || seen.has(f.url)) return;
        seen.add(f.url);
        formats.push(f);
      };

      // 1) bitrateInfo: filigransız akışlar, birden çok çözünürlük
      for (const b of U.ensureArray(video.bitrateInfo)) {
        const play = b && b.PlayAddr;
        const url = play && Array.isArray(play.UrlList) ? play.UrlList[0] : null;
        if (!url) continue;
        const height =
          Number(play.Height) ||
          heightFromQualityType(b.qualityType || b.QualityType || b.gearName || b.GearName);
        push({
          id: 'tt-' + (height || formats.length),
          kind: 'video',
          label: (height ? height + 'p' : 'Video') + ' MP4 • filigransız',
          tag: height ? height + 'p' : 'video',
          height,
          ext: 'mp4',
          bitrate: Number(b.Bitrate) || 0,
          size: Number(play.DataSize) || null,
          url
        });
      }

      // 2) playAddr yedeği
      if (video.playAddr && typeof video.playAddr === 'string') {
        push({
          id: 'tt-play',
          kind: 'video',
          label: (video.height ? video.height + 'p' : 'Video') + ' MP4',
          tag: video.height ? video.height + 'p' : 'video',
          height: Number(video.height) || 0,
          ext: 'mp4',
          bitrate: 0,
          size: null,
          url: video.playAddr
        });
      }

      // 3) downloadAddr (genelde filigranlı)
      if (video.downloadAddr && typeof video.downloadAddr === 'string') {
        push({
          id: 'tt-download',
          kind: 'video',
          label: (video.height ? video.height + 'p' : 'Video') + ' MP4 • filigranlı',
          tag: 'indirme',
          height: Number(video.height) || 0,
          ext: 'mp4',
          bitrate: 0,
          size: null,
          url: video.downloadAddr
        });
      }

      formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    } else {
      domError = Object.assign(new Error('TikTok video verisi bulunamadı'), {
        hint: 'Sayfayı yenileyip tekrar deneyin; ya da yardımcı satırını kullanın.'
      });
    }

    if (helperRows.length) {
      info.note =
        'Önerilen: en üstteki yardımcı satırı (filigransız MP4). Alttaki tarayıcı satırları ' +
        'TikTok CDN koruması nedeniyle bazı videolarda hata verebilir.';
    }

    if (!formats.length && !helperRows.length) {
      throw (
        domError ||
        Object.assign(new Error('TikTok video bağlantısı bulunamadı'), {
          hint: 'Video herkese açık olmayabilir.'
        })
      );
    }

    return { info, formats: [...helperRows, ...formats] };
  }

  return { platform: PLATFORM, getContext, getFormats };
})();
