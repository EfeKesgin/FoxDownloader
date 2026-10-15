// Popup: bu sayfadaki formatlar + indirme kuyruğu.
(() => {
  const P = globalThis.VD_PROTOCOL;
  const U = globalThis.VD_UTILS;

  const KIND_ORDER = ['helper-video', 'video', 'video-only', 'helper-audio', 'audio'];
  const KIND_TITLES = {
    'helper-video': 'Yüksek Kalite • Yardımcı (yt-dlp)',
    video: 'Video + Ses',
    'video-only': 'Yüksek Kalite (sadece görüntü)',
    'helper-audio': 'Sadece Ses • Yardımcı (yt-dlp)',
    audio: 'Sadece Ses'
  };

  const $ = (sel) => document.querySelector(sel);
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  let activeTabId = null;
  let activeTabUrl = '';
  let pageInfo = null;

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

  // ---- sekmeler ----

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tabpane').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('#tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // ---- bu sayfa ----

  async function initPageTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    activeTabId = tab.id;
    activeTabUrl = tab.url || '';

    if (!isSupportedUrl(activeTabUrl)) {
      $('#pageContent').className = 'state';
      $('#pageContent').innerHTML = 'Bu sayfa desteklenmiyor.<br>YouTube, X veya TikTok sayfası açın.';
      return;
    }

    await loadPageFormats();
  }

  async function loadPageFormats(force = false) {
    const el = $('#pageContent');
    el.className = 'state';
    el.innerHTML = 'Formatlar aranıyor…';
    let res = null;
    try {
      res = await chrome.tabs.sendMessage(activeTabId, { type: P.GET_PAGE_FORMATS, force });
    } catch {
      res = null;
    }
    if (!res) {
      el.className = 'state';
      el.innerHTML =
        'Sayfaya bağlanılamadı.' +
        '<div class="hint">Eklenti yeni güncellendiyse bu sekmeyi bir kez yenileyin (F5).</div>' +
        '<button id="retry">Tekrar dene</button>';
      $('#retry')?.addEventListener('click', () => loadPageFormats(true));
      return;
    }
    if (!res.ok) {
      el.className = 'state';
      el.innerHTML =
        escapeHtml(res.error || 'Video bulunamadı') +
        (res.hint ? '<div class="hint">' + escapeHtml(res.hint) + '</div>' : '') +
        '<button id="retry">Tekrar dene</button>';
      $('#retry')?.addEventListener('click', () => loadPageFormats(true));
      return;
    }
    pageInfo = res.info;
    renderPageFormats(res.info, res.formats, res.helper);
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

    let html = '<div class="video-head"><div class="video-title">' + escapeHtml(info?.title || 'Video') + '</div>';
    const bits = [];
    if (info?.platform) bits.push(info.platform);
    if (info?.author) bits.push(info.author);
    if (info?.duration) bits.push(U.formatDuration(info.duration));
    html += '<div class="video-sub">' + escapeHtml(bits.join(' • ')) + '</div>';
    if (info?.note) {
      html += '<div class="video-sub" style="color:var(--warn)">' + escapeHtml(info.note) + '</div>';
    }
    html += '</div>';

    // Kurulum zorunlu: yardımcı kurulu değilse indirme listesi gösterilmez.
    if ((helper && helper.installed === false) || info?.helper?.installed === false) {
      html +=
        '<div class="video-body"><div style="padding:14px;font-size:12px;color:var(--muted)">' +
        '<b>Kurulum gerekli.</b><br>' +
        'FoxDownloader Yardımcısı kurulu değil; indirmeler yardımcı üzerinden yapılır. ' +
        'Kurulum tek seferliktir ve yönetici izni gerektirmez.<br><br>' +
        '<button id="openOptions" class="linkbtn">Ayarları aç → kurulum</button>' +
        '</div></div>';
      el.className = 'sheet';
      el.innerHTML = html;
      el.querySelector('#openOptions')?.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
      });
      return;
    }

    html += '<div class="video-body">';

    if (!order.length) {
      html += '<div style="padding:14px;font-size:12px;color:var(--muted);">İndirilebilir format yok. Video kilitliyse oynatıp <b>Tekrar dene</b>ye basın.</div>';
    } else {
      for (const kind of order) {
        html += '<div class="group"><h4>' + escapeHtml(KIND_TITLES[kind] || kind) + '</h4>';
        for (const f of groups.get(kind)) {
          const meta = [];
          if (f.size) meta.push(U.formatBytes(f.size));
          if (f.bitrate) meta.push(U.formatBitrate(f.bitrate));
          if (f.ext) meta.push(String(f.ext).toUpperCase());
          if (f.note) meta.push(f.note);
          html +=
            '<div class="row"><div class="info"><div class="label">' +
            escapeHtml(f.label || 'Video') +
            '</div><div class="meta' +
            (f.note ? ' note' : '') +
            '">' +
            escapeHtml(meta.join(' • ')) +
            '</div></div>';
          if (f.disabled) {
            html += '<button class="dl" disabled title="' + escapeHtml(f.disabledReason || 'Kilitli') + '">Kilitli</button>';
          } else {
            html += '<button class="dl" data-fid="' + escapeHtml(f.id) + '">İndir</button>';
          }
          html += '</div>';
        }
        html += '</div>';
      }
    }
    html += '</div>';
    el.className = 'sheet';
    el.innerHTML = html;

    el.querySelector('#openOptions')?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    el.querySelectorAll('.dl[data-fid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const format = (formats || []).find((f) => String(f.id) === btn.dataset.fid);
        if (!format) return;
        btn.disabled = true;
        btn.textContent = '…';
        const platform = info?.platform || 'Video';
        const author = info?.author || '';
        const title = info?.title || '';
        const tag = format.tag || format.label || '';
        const isHelper = format.via === 'helper';
        const item = {
          url: format.url,
          filename: isHelper
            ? U.buildName({ author, title, tag })
            : U.buildFilename({
                platform,
                author,
                title,
                tag,
                ext: format.ext || 'mp4'
              }),
          platform,
          title,
          author,
          quality: tag,
          size: format.size || null,
          selector: format.selector || null,
          tabId: activeTabId,
          via: isHelper ? 'helper' : platform === 'TikTok' ? 'frontend' : 'native'
        };
        const out = await send({ type: P.ENQUEUE, item });
        if (out && out.ok) {
          btn.textContent = 'Eklendi ✓';
        } else {
          btn.disabled = false;
          btn.textContent = 'İndir';
        }
      });
    });
  }

  // ---- kuyruk ----

  const STATE_LABELS = {
    queued: 'Sırada',
    starting: 'Başlıyor',
    downloading: 'İniyor',
    fetching: 'Sayfada indiriliyor',
    paused: 'Duraklatıldı',
    complete: 'Bitti',
    error: 'Hata',
    canceled: 'İptal'
  };

  function renderQueue(queue) {
    const el = $('#queueContent');
    const count = $('#queueCount');
    const active = queue.filter((i) => ['downloading', 'starting', 'fetching', 'paused', 'queued'].includes(i.state)).length;
    count.hidden = active === 0;
    count.textContent = String(active);

    if (!queue.length) {
      el.className = 'state';
      el.innerHTML = 'Kuyruk boş.';
      return;
    }

    let html = '';
    for (const item of queue) {
      const total = item.totalBytes || item.size || 0;
      const pct = total > 0 ? Math.min(100, Math.round(((item.bytesReceived || 0) / total) * 100)) : 0;
      const indeterminate = (item.state === 'downloading' || item.state === 'fetching') && !total;
      const isHelper = item.via === 'helper';
      const subBits = [];
      subBits.push(item.platform || 'Video');
      if (item.quality) subBits.push(item.quality);
      if (isHelper) subBits.push('yardımcı');
      if (total > 0) subBits.push(U.formatBytes(item.bytesReceived || 0) + ' / ' + U.formatBytes(total));
      else if (item.bytesReceived > 0) subBits.push(U.formatBytes(item.bytesReceived));
      if ((item.state === 'downloading' || item.state === 'fetching') && item.speed > 0) subBits.push(U.formatSpeed(item.speed));
      if (item.state === 'complete' && item.filePath) subBits.push(String(item.filePath).split(/[\\/]/).pop());
      if (item.error) subBits.push(item.error);

      const actions = [];
      if (item.state === 'fetching') {
        actions.push('<button data-act="cancel" data-id="' + item.id + '">İptal</button>');
      } else if (item.state === 'downloading' || item.state === 'starting') {
        // Yardımcı (yt-dlp) indirmeleri duraklatılamaz; yalnızca iptal edilebilir.
        if (!isHelper) actions.push('<button data-act="pause" data-id="' + item.id + '">Duraklat</button>');
        actions.push('<button data-act="cancel" data-id="' + item.id + '">İptal</button>');
      } else if (item.state === 'paused') {
        actions.push('<button data-act="resume" data-id="' + item.id + '">Devam</button>');
        actions.push('<button data-act="cancel" data-id="' + item.id + '">İptal</button>');
      } else if (item.state === 'error' || item.state === 'canceled') {
        actions.push('<button data-act="retry" data-id="' + item.id + '">Tekrar</button>');
        actions.push('<button data-act="remove" data-id="' + item.id + '">Kaldır</button>');
      } else if (item.state === 'complete') {
        if (item.downloadId != null || item.filePath || item.dir) {
          actions.push('<button data-act="reveal" data-id="' + item.id + '">Klasörde göster</button>');
        }
        actions.push('<button data-act="remove" data-id="' + item.id + '">Kaldır</button>');
      } else {
        actions.push('<button data-act="cancel" data-id="' + item.id + '">İptal</button>');
      }

      html +=
        '<div class="qitem"><div class="qtitle">' +
        escapeHtml(item.title || item.filename || 'Video') +
        '</div><div class="qsub">' +
        escapeHtml(subBits.filter(Boolean).join(' • ')) +
        '</div>' +
        '<div class="qbar' +
        (indeterminate ? ' indet' : '') +
        '"><div style="width:' +
        (indeterminate ? 35 : pct) +
        '%"></div></div>' +
        '<div class="qrow2"><span class="qstate ' +
        item.state +
        '">' +
        escapeHtml((STATE_LABELS[item.state] || item.state) + (item.state === 'downloading' && pct ? ' %' + pct : '')) +
        '</span><div class="qactions">' +
        actions.join('') +
        '</div></div></div>';
    }
    el.className = 'sheet';
    el.innerHTML = html;

    el.querySelectorAll('.qactions button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        const typeMap = {
          pause: P.PAUSE_ITEM,
          resume: P.RESUME_ITEM,
          cancel: P.CANCEL_ITEM,
          remove: P.REMOVE_ITEM,
          retry: P.RETRY_ITEM,
          reveal: P.REVEAL_ITEM
        };
        btn.disabled = true;
        await send({ type: typeMap[act], id });
      });
    });
  }

  async function refreshQueue() {
    const res = await send({ type: P.GET_QUEUE });
    if (res && res.ok) renderQueue(res.queue || []);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === P.QUEUE_UPDATE) {
      renderQueue(msg.queue || []);
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

  initPageTab();
  refreshQueue();
  initSettings();
})();
