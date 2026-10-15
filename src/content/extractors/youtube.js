// YouTube çıkarıcı: player yanıtını okur, indirilebilir formatları listeler.
//
// 2026 GERÇEĞİ: YouTube web player'ı adaptif akışları SABR (UMP/PO-token) protokolüyle
// sunuyor; bu akışlar chrome.downloads veya normal GET ile indirilemez. Player yanıtında
// yalnızca eski usul "progressive" formatlar (örn. itag 18 / 360p) doğrudan URL veya
// signatureCipher ile gelir. Bu yüzden:
//   - url'li formatlar doğrudan indirilir,
//   - signatureCipher'lı formatlar oynatma sırasında sniffer ile yakalanınca açılır,
//   - SABR-only formatlar listelenmez, bilgi notu gösterilir.
globalThis.VD = globalThis.VD || {};
globalThis.VD.extractors = globalThis.VD.extractors || {};

globalThis.VD.extractors.youtube = (() => {
  const U = globalThis.VD_UTILS;
  const P = globalThis.VD_PROTOCOL;
  const PLATFORM = 'YouTube';

  const MIME_EXT = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/webm': 'webm'
  };

  function getContext(url = location.href) {
    try {
      const u = new URL(url);
      if (u.hostname.endsWith('youtu.be')) {
        const id = u.pathname.slice(1).split('/')[0];
        return id ? context(id) : null;
      }
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        return id ? context(id) : null;
      }
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,20})/);
      return m ? context(m[2]) : null;
    } catch {
      return null;
    }
  }

  function context(videoId) {
    return { platform: PLATFORM, videoId, key: 'yt:' + videoId };
  }

  function playerResponseFromDom() {
    for (const script of document.scripts) {
      const text = script.textContent || '';
      if (text.includes('ytInitialPlayerResponse')) {
        const json = U.parseEmbeddedJson(text, 'ytInitialPlayerResponse');
        if (json && json.videoDetails) return json;
      }
    }
    return null;
  }

  async function getPlayerResponse(videoId) {
    // DOM'daki yanıt yalnızca ilk yüklemede taze olur; SPA geçişlerinde
    // arka plandan (SW) taze yanıt isteriz.
    const dom = playerResponseFromDom();
    if (dom && dom.videoDetails && dom.videoDetails.videoId === videoId) return dom;
    try {
      const res = await chrome.runtime.sendMessage({ type: P.FETCH_YT_PLAYER, videoId });
      if (res && res.ok && res.player) return res.player;
    } catch {
      // yoksay
    }
    return dom;
  }

  function parseError(player) {
    const status = player && player.playabilityStatus;
    if (!status || status.status === 'OK') return null;
    if (status.status === 'LOGIN_REQUIRED') {
      return 'Bu video için oturum açmanız gerekiyor (yaş kısıtı olabilir).';
    }
    return status.reason ? 'YouTube: ' + status.reason : 'Video oynatılamıyor.';
  }

  function buildFormat(f) {
    const mime = String(f.mimeType || '').split(';')[0];
    const ext = MIME_EXT[mime] || (mime.startsWith('audio/') ? 'm4a' : 'mp4');
    const hasVideo = !mime.startsWith('audio/') && (f.qualityLabel != null || f.width != null);
    const hasAudio = !!f.audioQuality || mime.startsWith('audio/');
    const kind = !hasVideo ? 'audio' : hasAudio ? 'video' : 'video-only';

    let label;
    let tag;
    if (kind === 'audio') {
      const codec = /mp4/.test(mime) ? 'M4A' : 'Opus';
      label = 'Ses • ' + codec + ' ' + U.formatBitrate(f.averageBitrate || f.bitrate);
      tag = 'ses';
    } else {
      label = (f.qualityLabel || (f.height ? f.height + 'p' : 'Video')) + ' ' + ext.toUpperCase();
      tag = String(f.qualityLabel || f.height + 'p').replace(/\s+/g, '');
      if (kind === 'video') {
        label += ' • sesli';
        tag += ' sesli';
      } else {
        label += ' • ses yok';
        tag += ' sadece-goruntu';
      }
    }

    const format = {
      id: 'itag-' + f.itag,
      itag: f.itag,
      height: f.height || 0,
      kind,
      label,
      tag,
      ext,
      size: f.contentLength ? Number(f.contentLength) : null,
      bitrate: f.averageBitrate || f.bitrate || 0,
      url: f.url || null,
      disabled: false
    };

    if (!format.url && f.signatureCipher) {
      format.cipherItag = U.parseItagFromCipher(f.signatureCipher) || f.itag;
      format.disabled = true;
      format.disabledReason = 'Önce videoyu sayfada birkaç saniye oynatın, sonra Yenile';
      format.note = 'oynatınca açılır';
    }
    return format;
  }

  function sortFormats(formats) {
    const rank = { video: 0, 'video-only': 1, audio: 2 };
    return formats.sort((a, b) => {
      if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
      const av = a.kind === 'audio' ? a.bitrate : (a.height || a.bitrate || 0);
      const bv = b.kind === 'audio' ? b.bitrate : (b.height || b.bitrate || 0);
      return bv - av;
    });
  }

  async function getFormats(ctx) {
    const player = await getPlayerResponse(ctx.videoId);
    if (!player) {
      throw Object.assign(new Error('YouTube video bilgisi alınamadı'), {
        hint: 'Sayfayı yenileyip tekrar deneyin.'
      });
    }
    const err = parseError(player);
    if (err) throw Object.assign(new Error(err), { hint: null });

    const details = player.videoDetails || {};
    const info = {
      platform: PLATFORM,
      title: details.title || document.title,
      author: details.author || '',
      duration: Number(details.lengthSeconds) || 0,
      videoId: ctx.videoId,
      note: null
    };

    const streaming = player.streamingData || {};
    if (!streaming.formats && !streaming.adaptiveFormats) {
      throw Object.assign(
        new Error(details.isLive ? 'Canlı yayınlar indirilemiyor.' : 'İndirilebilir akış bulunamadı.'),
        { hint: details.isLive ? null : null }
      );
    }

    const raw = [...U.ensureArray(streaming.formats), ...U.ensureArray(streaming.adaptiveFormats)];
    let sabrOnly = 0;
    const seen = new Set();
    const formats = [];
    for (const f of raw) {
      const hasDirect = !!f.url || !!f.signatureCipher;
      if (!hasDirect) {
        sabrOnly++;
        continue; // SABR/UMP akışı: eklenti indiremez
      }
      const format = buildFormat(f);
      const key = format.itag + ':' + format.kind;
      if (seen.has(key)) continue;
      seen.add(key);
      formats.push(format);
    }
    sortFormats(formats);

    const helperStatus = await getHelperStatus();
    const helperRows = helperFormats(helperStatus, ctx.videoId);
    const helperOk = helperRows.length > 0;
    info.helper = {
      installed: !!(helperStatus && helperStatus.ok && helperStatus.ytdlp),
      ffmpeg: !!(helperStatus && helperStatus.ffmpeg),
      dir: (helperStatus && helperStatus.dir) || ''
    };

    const maxProgressive = formats.filter((f) => f.kind === 'video' && !f.disabled && f.height).map((f) => f.height);
    const best = maxProgressive.length ? Math.max(...maxProgressive) : 0;
    if (sabrOnly > 0 || helperOk) {
      const base = best ? 'Tarayıcıdan en iyi kalite: ' + best + 'p. ' : '';
      if (helperOk) {
        info.note = helperStatus.ffmpeg
          ? base + 'Yüksek kaliteler (4K dâhil) YouTube Yardımcısı ile MP4 olarak indirilir.'
          : base +
            'FFmpeg kurulu değil: yalnızca tek parça akış sunan videolar indirilebilir. ' +
            'Tam kalite için kurulumu yeniden çalıştırıp FFmpeg sorusuna "e" deyin (Ayarlar).';
      } else if (helperStatus && !info.helper.installed) {
        info.note =
          base +
          'Yüksek kaliteler (1080p+) YouTube\u2019un SABR/PO-token akış sistemiyle korunuyor; ' +
          'YouTube Yardımcısını kurarak 4K\u2019ya kadar indirebilirsiniz (Ayarlar).';
      } else {
        info.note = base + 'Yüksek kaliteler SABR korumalı: yalnızca tarayıcıdan indirilebilenler listelendi.';
      }
    }

    if (!formats.length && !helperRows.length) {
      throw Object.assign(new Error('Bu videoda eklentiyle indirilebilir akış yok.'), {
        hint: '1080p+ akışlar SABR korumalı. YouTube Yardımcısı ile tüm kaliteler indirilebilir (Ayarlar).'
      });
    }

    return { info, formats: [...helperRows, ...formats] };
  }

  // ---------- YouTube yardımcısı (yt-dlp + native messaging) ----------
  //
  // 1080p ve üzeri akışlar SABR/PO-token korumalı olduğu için tarayıcıdan
  // indirilemez. İsteğe bağlı yardımcı (yt-dlp.exe) kuruluysa yüksek kaliteler
  // onun üzerinden indirilir; kurulu değilse yalnızca tarayıcı formatları kalır.

  const HELPER_LADDER = [
    { height: 2160, tag: '2160p', label: '2160p (4K)' },
    { height: 1440, tag: '1440p', label: '1440p' },
    { height: 1080, tag: '1080p', label: '1080p' },
    { height: 720, tag: '720p', label: '720p' },
    { height: 480, tag: '480p', label: '480p' },
    { height: 360, tag: '360p', label: '360p' }
  ];

  async function getHelperStatus() {
    try {
      const res = await chrome.runtime.sendMessage({ type: P.HELPER_STATUS });
      return (res && res.status) || null;
    } catch {
      return null;
    }
  }

  function helperFormats(status, videoId) {
    const watchUrl = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
    if (!status || !status.ok || !status.ytdlp) return [];
    const hasFfmpeg = !!status.ffmpeg;
    const max = hasFfmpeg ? 2160 : 720;
    const rows = [];
    for (const row of HELPER_LADDER) {
      const h = row.height;
      if (h > max) continue;
      let selector;
      if (!hasFfmpeg) {
        // FFmpeg yok: birleştirme yapılamaz → yalnızca video+ses içeren tek
        // parça akışlar. (YouTube çoğu videoda bunları artık sunmuyor.)
        selector = 'b[height<=' + h + '][ext=mp4]/b[height<=' + h + ']';
      } else if (h <= 1080) {
        // 1) H.264 (en uyumlu) + AAC  2) MP4 konteynerli diğer kodlayıcılar
        // 3) herhangi bir akış   4) tek parça yedek
        selector =
          'bv[height<=' + h + '][vcodec^=avc1]+ba[ext=m4a]/' +
          'bv[height<=' + h + '][ext=mp4]+ba[ext=m4a]/' +
          'bv[height<=' + h + ']+ba/' +
          'b[height<=' + h + ']';
      } else {
        // 1440p/2160p: H.264 yok; aynı çözünürlükte MP4 (genelde AV1),
        // yoksa WebM/MKV (VP9/AV1) alınır; en sonda daha düşük çözünürlük.
        selector =
          'bv[height=' + h + '][vcodec^=avc1]+ba[ext=m4a]/' +
          'bv[height=' + h + '][ext=mp4]+ba[ext=m4a]/' +
          'bv[height=' + h + ']+ba/' +
          'b[height<=' + h + ']';
      }
      rows.push({
        id: 'helper-' + h,
        kind: 'helper-video',
        label: row.label + (h > 1080 ? ' (Yardımcı • MP4/WebM)' : ' (Yardımcı • MP4)'),
        tag: row.tag + ' yardımcı',
        ext: 'mp4',
        height: h,
        url: watchUrl,
        via: 'helper',
        selector,
        disabled: false,
        note: null
      });
    }
    rows.push({
      id: 'helper-audio',
      kind: 'helper-audio',
      label: 'Ses • M4A (Yardımcı)',
      tag: 'ses yardımcı',
      ext: 'm4a',
      url: watchUrl,
      via: 'helper',
      selector: 'ba[ext=m4a]/ba/b',
      disabled: false,
      note: null
    });
    return rows;
  }

  // Sniffer'da yakalanan googlevideo URL'leriyle kilitli (cipher'lı) formatları açar.
  function mergeSniffed(formats, sniffed) {
    if (!Array.isArray(sniffed) || !sniffed.length) return formats;
    const byItag = new Map();
    for (const s of sniffed) {
      if (s && s.itag != null && s.url) byItag.set(Number(s.itag), s);
    }
    return formats.map((f) => {
      if (!f.disabled || !f.cipherItag) return f;
      const hit = byItag.get(Number(f.cipherItag));
      if (!hit) return f;
      return {
        ...f,
        url: hit.url,
        disabled: false,
        disabledReason: null,
        note: f.note === 'oynatınca açılır' ? 'yakalandı' : f.note,
        size: f.size || hit.size || null
      };
    });
  }

  return { platform: PLATFORM, getContext, getFormats, mergeSniffed };
})();
