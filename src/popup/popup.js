// Popup: bu sayfadaki formatlar + indirme kuyruğu.
(() => {
  const P = globalThis.VD_PROTOCOL;
  const U = globalThis.VD_UTILS;

  const KIND_ORDER = ['helper-video', 'video', 'video-only', 'helper-audio', 'audio', 'helper-playlist'];
  const KIND_TITLES = {
    'helper-video': 'Video • Yardımcı (yt-dlp)',
    video: 'Video + Ses • Tarayıcı',
    'video-only': 'Sadece görüntü • Tarayıcı',
    'helper-audio': 'Sadece ses • Yardımcı',
    audio: 'Sadece ses • Tarayıcı',
    'helper-playlist': 'Oynatma listesinin tamamı'
  };

  const $ = (sel) => document.querySelector(sel);
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  let activeTabId = null;
  let activeTabUrl = '';
  let activeTabTitle = '';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isSupportedUrl(url) {
    try {
      const u = new URL(url);
      return (
        /(^|\.)youtube\.com$/.test(u.hostname) ||
        /(^|\.)tiktok\.com$/.test(u.hostname) ||
        /(^|\.)(twitter|x)\.com$/.test(u.hostname)
      );
    } catch {
      return false;
    }
  }

  function showState(html) {
    const el = $('#pageContent');
    el.className = 'state';
    el.innerHTML = html;
    return el;
  }

  // ---- sekmeler ----

  function selectTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  });

  // ---- yardımcı durumu (üst bar) ----

  function renderHelperLine(st) {
    const line = $('#helperLine');
    const text = $('#helperText');
    if (!st || !st.ok) {
      line.className = 'sub bad';
      text.textContent = 'Yardımcı kurulu değil';
      return;
    }
    const warn = st.helperV < 2 || !st.deno || !st.ffmpeg;
    line.className = 'sub ' + (warn ? 'warn' : 'ok');
    const bits = ['yt-dlp ' + (st.ytdlpV || '')];
    if (st.helperV < 2) bits.push('kurulum eski');
    else if (!st.deno) bits.push('Deno yok');
    if (!st.ffmpeg) bits.push('FFmpeg yok');
    text.textContent = bits.join(' • ');
  }

  async function getHelperStatus() {
    const res = await send({ type: P.HELPER_STATUS });
    return (res && res.status) || null;
  }

  // ---- bu sayfa ----

  async function initPageTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    activeTabId = tab.id;
    activeTabUrl = tab.url || '';
    activeTabTitle = tab.title || '';

    if (isSupportedUrl(activeTabUrl)) {
      await loadPageFormats();
      return;
    }
    if (U.isHttpUrl(activeTabUrl)) {
      await renderGenericPage();
      return;
    }
    showState('<div class="big">🦊</div>Bu sayfada indirilebilecek bir video yok.<div class="hint">YouTube, X, TikTok ya da video içeren başka bir site açın.</div>');
  }

  // YouTube/X/TikTok dışındaki siteler: yt-dlp 1000'den fazla siteyi tanır
  // (Instagram, Reddit, Vimeo, Twitch, Dailymotion…). Sayfa adresi yardımcıya verilir.
  async function renderGenericPage() {
    const st = await getHelperStatus();
    let host = '';
    try {
      host = new URL(activeTabUrl).hostname.replace(/^www\./, '');
    } catch {
      host = '';
    }
    const info = {
      platform: host || 'Web',
      title: activeTabTitle || host,
      author: '',
      generic: true,
      note: 'Bu site tanınırsa yt-dlp videoyu indirir; tanınmazsa indirme hata verir. Giriş gerektiren içerikler için Ayarlar → tarayıcı çerezleri.'
    };
    const installed = !!(st && st.ok && st.ytdlp);
    const formats = [];
    if (installed) {
      const best = st.ffmpeg ? 'bv*+ba/b' : 'b';
      formats.push(
        { id: 'g-1080', kind: 'helper-video', label: 'En iyi kalite (≤1080p)', tag: '1080p', ext: 'mp4', url: activeTabUrl, via: 'helper', selector: st.ffmpeg ? 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b' : 'b[height<=1080]/b' },
        { id: 'g-best', kind: 'helper-video', label: 'En yüksek kalite', tag: 'en iyi', ext: 'mp4', url: activeTabUrl, via: 'helper', selector: best }
      );
      if (st.ffmpeg) {
        formats.push({ id: 'g-mp3', kind: 'helper-audio', label: 'Sadece ses • MP3', tag: 'mp3', ext: 'mp3', url: activeTabUrl, via: 'helper', selector: 'ba/b', flags: ['mp3'] });
      }
    }
    renderPageFormats(info, formats, { installed });
  }

  async function loadPageFormats(force = false) {
    showState('<span class="spinner"></span>Formatlar aranıyor…');
    let res = null;
    try {
      res = await chrome.tabs.sendMessage(activeTabId, { type: P.GET_PAGE_FORMATS, force });
    } catch {
      res = null;
    }
    if (!res) {
      showState(
        'Sayfaya bağlanılamadı.' +
          '<div class="hint">Eklenti yeni güncellendiyse bu sekmeyi bir kez yenileyin (F5).</div>' +
          '<button id="retry" class="primary">Tekrar dene</button>'
      );
      $('#retry')?.addEventListener('click', () => loadPageFormats(true));
      return;
    }
    if (!res.ok) {
      showState(
        '<b>' + escapeHtml(res.error || 'Video bulunamadı') + '</b>' +
          (res.hint ? '<div class="hint">' + escapeHtml(res.hint) + '</div>' : '') +
          '<button id="retry" class="primary">Tekrar dene</button>'
      );
      $('#retry')?.addEventListener('click', () => loadPageFormats(true));
      return;
    }
    renderPageFormats(res.info, res.formats, res.helper);
  }

  function platformClass(platform) {
    const p = String(platform || '').toLowerCase();
    if (p === 'youtube') return 'yt';
    if (p === 'tiktok') return 'tt';
    if (p.startsWith('x')) return 'x';
    return 'web';
  }

  function platformGlyph(platform) {
    const c = platformClass(platform);
    // ︎: emoji yerine düz metin karakteri olarak çizilsin
    return c === 'yt' ? '▶︎' : c === 'tt' ? '♪︎' : c === 'x' ? '𝕏' : '◎';
  }

  // Satırın solundaki kısa kalite rozeti: "4K", "1080p", "MP3"…
  function badgeFor(f) {
    if (f.kind === 'helper-playlist') return { text: f.flags?.includes('mp3') ? 'MP3' : f.tag || 'Liste', hq: true };
    if (f.flags?.includes('mp3')) return { text: 'MP3', hq: false };
    if (f.flags?.includes('hq1080')) return { text: '1080 HQ', hq: true };
    if (f.kind === 'audio' || f.kind === 'helper-audio') return { text: String(f.ext || 'Ses').toUpperCase(), hq: false };
    if (f.height >= 2160) return { text: '4K', hq: true };
    if (f.height >= 1440) return { text: '2K', hq: true };
    if (f.height) return { text: f.height + 'p', hq: f.height >= 1080 };
    const m = String(f.label || '').match(/(\d{3,4})p/);
    return { text: m ? m[1] + 'p' : f.tag && f.tag.length <= 7 ? f.tag : 'Video', hq: false };
  }

  function videoCard(info) {
    const bits = [];
    if (info?.platform) bits.push(info.platform);
    if (info?.author) bits.push(info.author);
    const thumb = info?.thumb
      ? '<img src="' + escapeHtml(info.thumb) + '" alt="" />'
      : '<span>' + platformGlyph(info?.platform) + '</span>';
    const dur = info?.duration ? '<span class="dur">' + escapeHtml(U.formatDuration(info.duration)) + '</span>' : '';
    return (
      '<div class="video"><div class="thumb">' + thumb + dur + '</div>' +
      '<div class="vinfo"><div class="vtitle">' + escapeHtml(info?.title || 'Video') + '</div>' +
      '<div class="vmeta">' + escapeHtml(bits.join(' • ')) + '</div></div></div>'
    );
  }

  function renderPageFormats(info, formats, helper) {
    const el = $('#pageContent');
    const groups = new Map();
    for (const f of formats || []) {
      const kind = f.kind || 'video';
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(f);
    }
    const order = KIND_ORDER.filter((k) => groups.has(k));

    let html = videoCard(info);

    // Kurulum zorunlu: yardımcı kurulu değilse indirme listesi gösterilmez.
    if ((helper && helper.installed === false) || info?.helper?.installed === false) {
      html +=
        '<div class="state" style="margin-top:10px;padding:18px 16px">' +
        '<b>Kurulum gerekli</b><div class="hint">İndirmeler FoxDownloader Yardımcısı üzerinden yapılır. ' +
        'Kurulum tek seferliktir ve yönetici izni istemez.</div>' +
        '<button id="openOptions" class="primary">Ayarları aç</button></div>';
      el.className = '';
      el.innerHTML = html;
      el.querySelector('#openOptions')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
      return;
    }

    if (info?.note) html += '<div class="note">' + escapeHtml(info.note) + '</div>';

    if (!order.length) {
      html += '<div class="note warn">İndirilebilir format yok. Video kilitliyse oynatıp tekrar açın.</div>';
    }
    for (const kind of order) {
      html += '<div class="group"><h4>' + escapeHtml(KIND_TITLES[kind] || kind) + '</h4><div class="rows">';
      for (const f of groups.get(kind)) {
        const meta = [];
        if (f.size) meta.push(U.formatBytes(f.size));
        if (f.bitrate) meta.push(U.formatBitrate(f.bitrate));
        if (f.ext && f.kind !== 'helper-playlist') meta.push(String(f.ext).toUpperCase());
        if (f.note) meta.push(f.note);
        const badge = badgeFor(f);
        html +=
          '<div class="row"><span class="badge' + (badge.hq ? ' hq' : '') + '">' + escapeHtml(badge.text) + '</span>' +
          '<div class="info"><div class="label">' + escapeHtml(f.label || 'Video') + '</div>' +
          (meta.length ? '<div class="meta' + (f.note ? ' warn' : '') + '">' + escapeHtml(meta.join(' • ')) + '</div>' : '') +
          '</div>';
        if (f.disabled) {
          html += '<button class="dl" disabled title="' + escapeHtml(f.disabledReason || 'Kilitli') + '">Kilitli</button>';
        } else {
          html += '<button class="dl" data-fid="' + escapeHtml(f.id) + '">İndir</button>';
        }
        html += '</div>';
      }
      html += '</div></div>';
    }
    el.className = '';
    el.innerHTML = html;

    // Kapak yüklenemezse (CDN koruması) platform simgesine dön.
    el.querySelectorAll('.thumb img').forEach((img) => {
      img.addEventListener('error', () => {
        img.replaceWith(Object.assign(document.createElement('span'), { textContent: platformGlyph(info?.platform) }));
      });
    });

    el.querySelectorAll('.dl[data-fid]').forEach((btn) => {
      btn.addEventListener('click', () => enqueueFormat(btn, info, formats));
    });
  }

  async function enqueueFormat(btn, info, formats) {
    const format = (formats || []).find((f) => String(f.id) === btn.dataset.fid);
    if (!format) return;
    btn.disabled = true;
    btn.textContent = '…';
    const platform = info?.platform || 'Video';
    const author = info?.author || '';
    const isHelper = format.via === 'helper';
    const isPlaylist = Array.isArray(format.flags) && format.flags.includes('pl');
    const title = isPlaylist ? format.playlistTitle || info?.title || 'Liste' : info?.title || '';
    const tag = format.tag || format.label || '';
    const item = {
      url: format.url,
      filename: isHelper
        ? U.buildName({ author: isPlaylist ? '' : author, title, tag })
        : U.buildFilename({ platform, author, title, tag, ext: format.ext || 'mp4' }),
      platform,
      title: isPlaylist ? 'Liste: ' + title : title,
      author,
      quality: tag,
      size: format.size || null,
      selector: format.selector || null,
      flags: format.flags || [],
      tabId: activeTabId,
      via: isHelper ? 'helper' : platform === 'TikTok' ? 'frontend' : 'native'
    };
    const out = await send({ type: P.ENQUEUE, item });
    if (out && out.ok) {
      btn.classList.add('added');
      btn.textContent = 'Eklendi ✓';
    } else {
      btn.disabled = false;
      btn.textContent = 'İndir';
    }
  }

  // ---- kuyruk ----

  const STATE_LABELS = {
    queued: 'Sırada',
    starting: 'Başlıyor',
    downloading: 'İniyor',
    fetching: 'Sayfada iniyor',
    paused: 'Duraklatıldı',
    complete: 'Bitti',
    error: 'Hata',
    canceled: 'İptal edildi'
  };

  const ACTIVE_STATES = ['downloading', 'starting', 'fetching', 'paused', 'queued'];

  function actionButtons(item) {
    const b = (act, label) => '<button data-act="' + act + '" data-id="' + escapeHtml(item.id) + '">' + label + '</button>';
    const isHelper = item.via === 'helper';
    if (item.state === 'fetching') return [b('cancel', 'İptal')];
    if (item.state === 'downloading' || item.state === 'starting') {
      // Yardımcı (yt-dlp) indirmeleri duraklatılamaz; yalnızca iptal edilebilir.
      return isHelper ? [b('cancel', 'İptal')] : [b('pause', 'Duraklat'), b('cancel', 'İptal')];
    }
    if (item.state === 'paused') return [b('resume', 'Devam'), b('cancel', 'İptal')];
    if (item.state === 'error' || item.state === 'canceled') return [b('retry', 'Tekrar'), b('remove', 'Kaldır')];
    if (item.state === 'complete') {
      const out = [];
      if (item.downloadId != null || item.filePath || item.dir) out.push(b('reveal', 'Klasörü aç'));
      out.push(b('remove', 'Kaldır'));
      return out;
    }
    return [b('cancel', 'İptal')];
  }

  function renderQueue(queue, update) {
    const el = $('#queueContent');
    const count = $('#queueCount');
    const active = queue.filter((i) => ACTIVE_STATES.includes(i.state)).length;
    count.hidden = active === 0;
    count.textContent = String(active);
    $('#updateBanner').hidden = !(update && update.running);

    if (!queue.length) {
      el.className = 'state';
      el.innerHTML = '<div class="big">📥</div>Henüz indirme yok.<div class="hint">“Bu sayfa” sekmesinden bir kalite seçin.</div>';
      return;
    }

    let html = '';
    for (const item of queue) {
      const total = item.totalBytes || item.size || 0;
      // İndirme bitti, yardımcı 1080p'ye dönüştürüyor: çubuk dönüştürme yüzdesini gösterir.
      const encoding = item.state === 'downloading' && item.encPct != null;
      const pct = encoding
        ? item.encPct
        : total > 0
          ? Math.min(100, Math.round(((item.bytesReceived || 0) / total) * 100))
          : 0;
      const running = item.state === 'downloading' || item.state === 'fetching';
      const indeterminate = running && !total && !encoding;
      const sub = [];
      if (item.quality) sub.push(item.quality);
      if (encoding) sub.push('1080p H.264\'e dönüştürülüyor');
      if (item.plCount > 0 && item.state !== 'complete') sub.push('Liste ' + (item.plIndex || 1) + '/' + item.plCount);
      if (item.state === 'complete' && item.files > 1) sub.push(item.files + ' dosya');
      if (!encoding) {
        if (total > 0 && item.state !== 'complete') sub.push(U.formatBytes(item.bytesReceived || 0) + ' / ' + U.formatBytes(total));
        else if (item.bytesReceived > 0) sub.push(U.formatBytes(item.bytesReceived));
        if (running && item.speed > 0) sub.push(U.formatSpeed(item.speed));
      }
      if (item.state === 'complete' && item.filePath && !(item.files > 1)) sub.push(String(item.filePath).split(/[\\/]/).pop());
      if (item.note) sub.push(item.note);

      const barClass = 'qbar' + (indeterminate ? ' indet' : '') + (item.state === 'complete' ? ' done' : '');
      const barWidth = item.state === 'complete' ? 100 : indeterminate ? 35 : pct;
      const showBar = running || item.state === 'complete' || item.state === 'paused' || pct > 0;
      const label = encoding
        ? 'Dönüştürülüyor • %' + pct
        : (STATE_LABELS[item.state] || item.state) + (item.state === 'downloading' && pct ? ' • %' + pct : '');

      html +=
        '<div class="qitem"><div class="qhead"><span class="plat ' + platformClass(item.platform) + '">' +
        platformGlyph(item.platform) + '</span><div class="qtitle" title="' + escapeHtml(item.title || item.filename || '') + '">' +
        escapeHtml(item.title || item.filename || 'Video') + '</div></div>' +
        (sub.length ? '<div class="qsub">' + escapeHtml(sub.join(' • ')) + '</div>' : '') +
        (item.error ? '<div class="qerr">' + escapeHtml(item.error) + '</div>' : '') +
        (item.warning ? '<div class="qerr warn">Bazı videolar atlandı: ' + escapeHtml(item.warning) + '</div>' : '') +
        (showBar ? '<div class="' + barClass + '"><div style="width:' + barWidth + '%"></div></div>' : '') +
        '<div class="qrow2"><span class="chip ' + escapeHtml(item.state) + '">' + escapeHtml(label) + '</span>' +
        '<div class="qactions">' + actionButtons(item).join('') + '</div></div></div>';
    }
    el.className = 'qlist';
    el.innerHTML = html;

    el.querySelectorAll('.qactions button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const typeMap = {
          pause: P.PAUSE_ITEM,
          resume: P.RESUME_ITEM,
          cancel: P.CANCEL_ITEM,
          remove: P.REMOVE_ITEM,
          retry: P.RETRY_ITEM,
          reveal: P.REVEAL_ITEM
        };
        btn.disabled = true;
        await send({ type: typeMap[btn.dataset.act], id: btn.dataset.id });
      });
    });
  }

  async function refreshQueue() {
    const res = await send({ type: P.GET_QUEUE });
    if (res && res.ok) renderQueue(res.queue || [], res.update);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === P.QUEUE_UPDATE) {
      renderQueue(msg.queue || [], msg.update);
      if (msg.settings) $('#concurrency').value = String(msg.settings.concurrency || 3);
    }
  });

  // ---- ayarlar ----

  async function initSettings() {
    const res = await send({ type: P.GET_SETTINGS });
    if (res && res.ok && res.settings) {
      $('#concurrency').value = String(res.settings.concurrency || 3);
    }
    $('#concurrency').addEventListener('change', async (e) => {
      await send({ type: P.SET_SETTINGS, settings: { concurrency: Number(e.target.value) } });
    });
  }

  $('#clearFinished').addEventListener('click', async () => {
    await send({ type: P.CLEAR_FINISHED });
    refreshQueue();
  });

  $('#openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ---- başlat ----

  getHelperStatus().then(renderHelperLine);
  initPageTab();
  refreshQueue();
  initSettings();
})();
