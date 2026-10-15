// Sayfa içi yüzen indir butonu ve format paneli (Shadow DOM ile izole edilmiş).
globalThis.VD_UI = (() => {
  const U = globalThis.VD_UTILS;
  const P = globalThis.VD_PROTOCOL;

  const KIND_ORDER = ['helper-video', 'video', 'video-only', 'helper-audio', 'audio'];
  const KIND_TITLES = {
    'helper-video': 'Yüksek Kalite • Yardımcı (yt-dlp)',
    video: 'Video + Ses',
    'video-only': 'Yüksek Kalite (sadece görüntü)',
    'helper-audio': 'Sadece Ses • Yardımcı (yt-dlp)',
    audio: 'Sadece Ses'
  };

  let host = null;
  let root = null;
  let fab = null;
  let badge = null;
  let panel = null;
  let panelBody = null;
  let panelTitle = null;
  let panelFooter = null;
  let open = false;
  let loaderFn = null;
  let queueInfo = { active: 0, queued: 0 };

  const CSS = `
    :host {
      all: initial;
      --bg: #161412;
      --surface: #201c19;
      --surface-2: #292420;
      --border: #3a332d;
      --text: #f3ede4;
      --muted: #a89d91;
      --accent: #dc7a3d;
      --accent-2: #c76a33;
      --accent-soft: rgba(220, 122, 61, .14);
      --warn: #d9ab55;
    }
    * { box-sizing: border-box; font-family: 'Segoe UI', Roboto, Arial, sans-serif; }
    .wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
    .fab {
      width: 48px; height: 48px; border-radius: 50%; border: 1px solid rgba(255,255,255,.08); cursor: pointer;
      background: var(--accent);
      color: #22160f; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 22px rgba(0,0,0,.38); position: relative; transition: transform .15s ease, background .15s ease;
    }
    .fab:hover { transform: scale(1.06); background: var(--accent-2); }
    .fab svg { width: 22px; height: 22px; }
    .badge {
      position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 4px;
      border-radius: 9px; background: #cd6a60; color: #fff; font-size: 11px; font-weight: 700;
      display: none; align-items: center; justify-content: center;
    }
    .badge.on { display: flex; }
    .panel {
      width: 340px; max-height: 440px; border-radius: 14px; overflow: hidden;
      background: var(--surface); color: var(--text); box-shadow: 0 18px 50px rgba(0,0,0,.5);
      display: none; flex-direction: column; border: 1px solid var(--border);
    }
    .panel.on { display: flex; }
    .head { padding: 12px 14px 10px; background: var(--surface-2); color: var(--text); border-bottom: 1px solid var(--border); }
    .head h3 { margin: 0; font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .head .sub { font-size: 11px; color: var(--muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .close { position: absolute; right: 10px; top: 10px; background: rgba(255,255,255,.06); border: none; color: var(--muted); width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 13px; line-height: 1; }
    .close:hover { background: var(--accent-soft); color: var(--accent); }
    .headwrap { position: relative; }
    .body { overflow-y: auto; padding: 8px 12px 12px; flex: 1; }
    .group { margin-top: 10px; }
    .group:first-child { margin-top: 2px; }
    .group h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
    .row { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 9px; }
    .row:hover { background: var(--accent-soft); }
    .row .info { flex: 1; min-width: 0; }
    .row .label { font-size: 13px; font-weight: 600; }
    .row .meta { font-size: 11px; color: var(--muted); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .note { color: var(--warn); }
    .dl {
      border: 1px solid rgba(0,0,0,.25); border-radius: 9px; padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer;
      background: var(--accent); color: #22160f; white-space: nowrap;
    }
    .dl:hover { background: var(--accent-2); }
    .dl:disabled { background: var(--surface-2); border-color: var(--border); color: var(--muted); cursor: not-allowed; }
    .foot { border-top: 1px solid var(--border); padding: 8px 12px; font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .foot button { border: none; background: none; color: var(--accent); font-weight: 600; font-size: 11px; cursor: pointer; padding: 2px 4px; }
    .state { padding: 18px 6px; text-align: center; font-size: 12px; color: var(--muted); }
    .spinner { width: 22px; height: 22px; margin: 0 auto 8px; border: 3px solid var(--accent-soft); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .toast {
      position: fixed; right: 18px; bottom: 78px; z-index: 2147483647;
      background: #241f1b; color: var(--text); border: 1px solid var(--border); padding: 9px 14px; border-radius: 10px;
      font-size: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.45); opacity: 0; transition: opacity .2s ease;
      pointer-events: none; max-width: 300px;
    }
    .toast.on { opacity: 1; }
  `;

  const FAB_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"/><path d="M6 10l6 6 6-6"/><path d="M5 21h14"/></svg>';

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('div');
    host.id = 'vd-root';
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    panel = document.createElement('div');
    panel.className = 'panel';
    const headwrap = document.createElement('div');
    headwrap.className = 'headwrap';
    headwrap.innerHTML =
      '<div class="head"><h3 class="vd-title">Video indir</h3><div class="sub vd-sub"></div></div>' +
      '<button class="close" title="Kapat">✕</button>';
    panel.appendChild(headwrap);
    panelBody = document.createElement('div');
    panelBody.className = 'body';
    panel.appendChild(panelBody);
    panelFooter = document.createElement('div');
    panelFooter.className = 'foot';
    panel.appendChild(panelFooter);
    panelTitle = headwrap.querySelector('.vd-title');

    fab = document.createElement('button');
    fab.className = 'fab';
    fab.title = 'Video indir';
    fab.innerHTML = FAB_SVG;
    badge = document.createElement('span');
    badge.className = 'badge';
    fab.appendChild(badge);
    fab.addEventListener('click', togglePanel);
    headwrap.querySelector('.close').addEventListener('click', () => setOpen(false));

    wrap.appendChild(panel);
    wrap.appendChild(fab);
    root.appendChild(wrap);

    const toast = document.createElement('div');
    toast.className = 'toast';
    root.appendChild(toast);
    toastEl = toast;

    (document.body || document.documentElement).appendChild(host);
  }

  let toastEl = null;
  let toastTimer = null;

  function toast(message) {
    ensureHost();
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600);
  }

  function showFab() {
    ensureHost();
    fab.style.display = 'flex';
  }

  function hideFab() {
    if (!host) return;
    fab.style.display = 'none';
    setOpen(false);
  }

  function setOpen(value) {
    open = value;
    if (!panel) return;
    panel.classList.toggle('on', open);
    if (open) load();
  }

  function togglePanel() {
    setOpen(!open);
  }

  function setLoading() {
    panelBody.innerHTML = '<div class="state"><div class="spinner"></div>Formatlar aranıyor…</div>';
    panelFooter.innerHTML = '';
  }

  function setError(message, hint) {
    const hintHtml = hint ? '<div style="margin-top:6px;color:var(--warn);">' + escapeHtml(hint) + '</div>' : '';
    panelBody.innerHTML = '<div class="state">' + escapeHtml(message) + hintHtml + '</div>';
    panelFooter.innerHTML = '<span></span><button class="vd-refresh">Tekrar dene</button>';
    panelFooter.querySelector('.vd-refresh').addEventListener('click', load);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Kurulum kapısı: yardımcı kurulu değilse indirme listesi gösterilmez.
  function setGate() {
    panelTitle.textContent = 'Kurulum gerekli';
    const subEl = root.querySelector('.vd-sub');
    if (subEl) subEl.textContent = 'Tek seferlik kurulum (~1 dakika)';
    panelBody.innerHTML =
      '<div class="state" style="text-align:left">' +
      '<b>FoxDownloader Yardımcısı kurulu değil.</b><br>' +
      'İndirmelerin tamamı (YouTube 1080p / 4K, TikTok, X) yardımcı üzerinden yapılır. ' +
      'Kurulum yönetici izni gerektirmez.' +
      '</div>';
    panelFooter.innerHTML =
      '<button class="vd-openopts">Ayarları aç</button><button class="vd-refresh">Kontrol et</button>';
    const open = panelFooter.querySelector('.vd-openopts');
    if (open) {
      open.addEventListener('click', () => {
        try {
          chrome.runtime.sendMessage({ type: globalThis.VD_PROTOCOL.OPEN_OPTIONS });
        } catch {
          // yoksay
        }
      });
    }
    const refresh = panelFooter.querySelector('.vd-refresh');
    if (refresh) refresh.addEventListener('click', load);
  }

  async function load() {
    if (!loaderFn) return;
    setLoading();
    try {
      const result = await loaderFn();
      if (result && result.helper && !result.helper.installed) {
        setGate();
        return;
      }
      renderFormats(result.formats, result.info);
    } catch (err) {
      setError(String((err && err.message) || err || 'Video bulunamadı'), (err && err.hint) || null);
    }
  }

  function renderFormats(formats, info) {
    panelTitle.textContent = (info && info.title) || 'Video indir';
    const subEl = root.querySelector('.vd-sub');
    if (subEl) {
      const bits = [];
      if (info && info.platform) bits.push(info.platform);
      if (info && info.author) bits.push(info.author);
      if (info && info.duration) bits.push(U.formatDuration(info.duration));
      subEl.textContent = bits.join(' • ');
    }

    const groups = new Map();
    for (const f of formats || []) {
      const kind = f.kind || 'video';
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(f);
    }

    const order = KIND_ORDER.filter((k) => groups.has(k));
    if (!order.length) {
      panelBody.innerHTML = '<div class="state">İndirilebilir format bulunamadı.<br>Video kilitliyse birkaç saniye oynatıp <b>Yenile</b>ye basın.</div>';
    } else {
      const frag = document.createDocumentFragment();
      if (info && info.note) {
        const note = document.createElement('div');
        note.className = 'state';
        note.style.padding = '6px 8px';
        note.style.textAlign = 'left';
        note.style.color = '#b06a00';
        note.textContent = info.note;
        frag.appendChild(note);
      }
      if (info && info.helper && info.helper.installed === false) {
        const btn = document.createElement('button');
        btn.className = 'dl';
        btn.textContent = 'Yardımcıyı kur (1080p+)';
        btn.style.margin = '0 8px 6px';
        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: P.OPEN_OPTIONS }).catch(() => {});
        });
        frag.appendChild(btn);
      }
      for (const kind of order) {
        const group = document.createElement('div');
        group.className = 'group';
        const h = document.createElement('h4');
        h.textContent = KIND_TITLES[kind] || kind;
        group.appendChild(h);
        for (const f of groups.get(kind)) {
          group.appendChild(renderRow(f, info));
        }
        frag.appendChild(group);
      }
      panelBody.innerHTML = '';
      panelBody.appendChild(frag);
    }

    panelFooter.innerHTML = '<span class="vd-qinfo"></span><button class="vd-refresh">Yenile</button>';
    panelFooter.querySelector('.vd-refresh').addEventListener('click', load);
    updateFooterQueue();
  }

  function renderRow(f, info) {
    const row = document.createElement('div');
    row.className = 'row';

    const infoEl = document.createElement('div');
    infoEl.className = 'info';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = f.label || 'Video';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const bits = [];
    if (f.size) bits.push(U.formatBytes(f.size));
    if (f.bitrate) bits.push(U.formatBitrate(f.bitrate));
    if (f.ext) bits.push(String(f.ext).toUpperCase());
    if (f.note) bits.push(f.note);
    meta.textContent = bits.join(' • ');
    if (f.note) meta.classList.add('note');
    infoEl.appendChild(label);
    infoEl.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'dl';
    if (f.disabled) {
      btn.disabled = true;
      btn.textContent = 'Kilitli';
      btn.title = f.disabledReason || 'Önce videoyu sayfada oynatın';
    } else {
      btn.textContent = 'İndir';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const item = buildQueueItem(f, info);
          const res = await chrome.runtime.sendMessage({ type: P.ENQUEUE, item });
          if (res && res.ok) {
            toast('Kuyruğa eklendi: ' + (f.label || 'video'));
          } else {
            toast('Eklenemedi: ' + ((res && res.error) || 'bilinmeyen hata'));
            btn.disabled = false;
            btn.textContent = 'İndir';
          }
        } catch (err) {
          toast('Eklenemedi: ' + String((err && err.message) || err));
          btn.disabled = false;
          btn.textContent = 'İndir';
        }
      });
    }

    row.appendChild(infoEl);
    row.appendChild(btn);
    return row;
  }

  function buildQueueItem(f, info) {
    const platform = (info && info.platform) || 'Video';
    const author = (info && info.author) || '';
    const title = (info && info.title) || '';
    const tag = f.tag || f.label || '';
    if (f.via === 'helper') {
      // Yardımcı indirmeleri yt-dlp'ye devredilir: klasörsüz ad + format seçici.
      return {
        url: f.url,
        filename: U.buildName({ author, title, tag }),
        platform,
        title,
        author,
        quality: tag,
        selector: f.selector,
        via: 'helper'
      };
    }
    const filename = U.buildFilename({
      platform,
      author,
      title,
      tag,
      ext: f.ext || 'mp4'
    });
    return {
      url: f.url,
      filename,
      platform,
      title,
      author,
      quality: tag,
      size: f.size || null,
      // TikTok CDN'i hotlink korumalı: indirme, sayfa bağlamında (cookie'li fetch) yapılır.
      via: platform === 'TikTok' ? 'frontend' : 'native'
    };
  }

  function setQueueStats(payload) {
    if (!payload || !Array.isArray(payload.queue)) return;
    let active = 0;
    let queued = 0;
    for (const item of payload.queue) {
      if (item.state === 'downloading' || item.state === 'starting' || item.state === 'fetching' || item.state === 'paused') active++;
      else if (item.state === 'queued') queued++;
    }
    queueInfo = { active, queued };
    if (badge) {
      const total = active + queued;
      badge.textContent = String(total);
      badge.classList.toggle('on', total > 0);
    }
    updateFooterQueue();
  }

  function updateFooterQueue() {
    if (!panelFooter) return;
    const el = panelFooter.querySelector('.vd-qinfo');
    if (!el) return;
    if (queueInfo.active + queueInfo.queued === 0) {
      el.textContent = 'Kuyruk boş';
    } else {
      el.textContent = queueInfo.active + ' indiriliyor' + (queueInfo.queued ? ', ' + queueInfo.queued + ' sırada' : '');
    }
  }

  function init(loader) {
    loaderFn = loader;
  }

  return { init, showFab, hideFab, openPanel: () => setOpen(true), toast, setQueueStats };
})();
