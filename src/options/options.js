// Ayarlar sayfası: YouTube Yardımcısı kurulumu/durumu + indirme ayarları.
(() => {
  const P = globalThis.VD_PROTOCOL;

  const $ = (sel) => document.querySelector(sel);
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  const STATUS_LABEL = {
    YARDIMCI_KURULU_DEGIL: 'kurulu değil',
    YT_DLP_YOK: 'yt-dlp eksik'
  };

  // Teşhis: durum kutusunda hangi yapının çalıştığını gösterir.
  const MANIFEST = chrome.runtime.getManifest();
  const EXT_LINE = 'Eklenti: ' + MANIFEST.name + ' v' + MANIFEST.version;

  // ---------- yardımcı durumu ----------

  function renderStatus(st) {
    const el = $('#helperStatus');
    if (!st) {
      el.className = 'status bad';
      el.innerHTML = '<b>✗ Durum okunamadı</b><div class="sub">Arka plan betiğine ulaşılamadı.</div>';
      return;
    }
    if (st.ok && st.ytdlp) {
      const parts = [];
      parts.push('yt-dlp ' + (st.ytdlpV ? st.ytdlpV : '(sürüm okunmadı)'));
      parts.push(st.ffmpeg ? 'FFmpeg ✓ (1080p+ / 4K)' : 'FFmpeg yok (en fazla 720p)');
      const dirText = st.dir ? st.dir : '(varsayılan)';
      const dirInput = $('#helperDir');
      if (dirInput && st.dir) dirInput.placeholder = 'Boş = ' + st.dir;
      el.className = 'status ok';
      el.innerHTML =
        '<b>✓ Yardımcı kurulu</b>' +
        '<div class="sub">' +
        parts.map(escapeHtml).join(' • ') +
        '<br>Hedef klasör: <code>' +
        escapeHtml(dirText) +
        '</code></div>' +
        (st.ffmpeg ? '' : '<div class="sub">1080p ve 4K için kurulumu yeniden çalıştırıp FFmpeg sorusuna "e" deyin.</div>') +
        '<div class="sub" style="opacity:.75">' + escapeHtml(EXT_LINE) + '</div>';
      return;
    }
    if (st.error === 'YT_DLP_YOK') {
      el.className = 'status warn';
      el.innerHTML =
        '<b>⚠ ythelper.exe var ama yt-dlp.exe yok</b>' +
        '<div class="sub">Kurulumu yeniden çalıştırın (yt-dlp indirilecek).</div>';
      return;
    }
    el.className = 'status bad';
    el.innerHTML =
      '<b>✗ Yardımcı kurulu değil</b>' +
      '<div class="sub">Adımları izleyin; kurulumdan sonra eklentiyi yenileyip tarayıcıyı yeniden başlatın.</div>' +
      (st.detail ? '<div class="sub"><code>' + escapeHtml(String(st.detail)) + '</code></div>' : '') +
      '<div class="sub" style="opacity:.75">' + escapeHtml(EXT_LINE) + '</div>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function checkHelper(force = true) {
    const el = $('#helperStatus');
    el.className = 'status';
    el.textContent = 'Durum kontrol ediliyor…';
    const res = await send({ type: P.HELPER_STATUS, force });
    const st = (res && res.status) || null;
    renderStatus(st);

    // Sürüm dosyada yoksa canlı sorgula (ilk kez yavaş olabilir: antivirüs taraması)
    if (st && st.ok && st.ytdlp && !st.ytdlpV) {
      const el2 = $('#helperStatus');
      el2.innerHTML += '<div class="sub" id="verLoading">yt-dlp sürümü sorgulanıyor… (ilk seferde uzun sürebilir)</div>';
      const v = await send({ type: P.HELPER_VERSION });
      const ver = v && v.version;
      if (ver) {
        el2.innerHTML = el2.innerHTML.replace(
          /yt-dlp \(sürüm okunmadı\)/,
          'yt-dlp ' + escapeHtml(ver)
        );
      }
      const loading = document.getElementById('verLoading');
      if (loading) loading.remove();
    }
  }

  // ---------- kurulum dosyaları ----------

  async function downloadAsset(relPath, fileName) {
    const url = chrome.runtime.getURL(relPath);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({
        url: blobUrl,
        filename: fileName,
        conflictAction: 'overwrite',
        saveAs: false
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    }
  }

  async function downloadPair(base, msgEl) {
    msgEl.className = 'msg';
    msgEl.textContent = 'Dosyalar indiriliyor… (tarayıcı "Sakla/Keep" onayı isteyebilir)';
    try {
      await downloadAsset('helper/' + base + '.ps1', base + '.ps1');
      await downloadAsset('helper/' + base + '.cmd', base + '.cmd');
      msgEl.className = 'msg ok';
      msgEl.innerHTML =
        'İndirilenler klasörüne <code>' +
        escapeHtml(base + '.cmd') +
        '</code> ve <code>' +
        escapeHtml(base + '.ps1') +
        '</code> indirildi. Şimdi <b>' +
        escapeHtml(base + '.cmd') +
        '</b> dosyasına çift tıklayın (iki dosya aynı klasörde kalmalı).';
    } catch (err) {
      msgEl.className = 'msg bad';
      msgEl.textContent = 'İndirilemedi: ' + String((err && err.message) || err);
    }
  }

  // ---------- ayarlar ----------

  async function loadSettings() {
    const res = await send({ type: P.GET_SETTINGS });
    const s = (res && res.settings) || {};
    $('#concurrency').value = String(s.concurrency || 3);
    $('#autoRetry').checked = s.autoRetry !== false;
    $('#helperDir').value = s.helperDir || '';
    $('#helperCookies').value = s.helperCookies || '';
  }

  let saveTimer = null;
  function flashMsg(text, kind) {
    const el = $('#settingsMsg');
    el.className = 'msg ' + (kind || 'ok');
    el.textContent = text;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      el.textContent = '';
      el.className = 'msg';
    }, 2600);
  }

  function flashSaved() {
    flashMsg('Kaydedildi ✓', 'ok');
  }

  async function saveSettings(patch) {
    await send({ type: P.SET_SETTINGS, settings: patch });
    flashSaved();
  }

  // Klasör seçme penceresi (pencereyi yardımcı süreci açar).
  async function pickFolder() {
    const btn = $('#browseDirBtn');
    const input = $('#helperDir');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Pencere açılıyor…';
    try {
      const res = await send({ type: P.PICK_DIR, initial: input.value.trim() });
      if (res && res.ok) {
        if (res.dir) {
          input.value = res.dir;
          await saveSettings({ helperDir: res.dir });
        }
      } else if (res && res.error === 'YARDIMCI_KURULU_DEGIL') {
        flashMsg('Klasör seçici için önce yardımcıyı kurun; yolu elle de yazabilirsiniz.', 'bad');
      } else {
        flashMsg('Klasör seçilemedi: ' + ((res && res.error) || 'bilinmeyen hata'), 'bad');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  // ---------- bağlama ----------

  $('#browseDirBtn').addEventListener('click', () => {
    pickFolder();
  });

  // ---------- teşhis araçları ----------

  $('#reloadExtBtn').addEventListener('click', () => {
    // Diskteki son sürümü yükler; tarayıcı belleğinde eski kod kalmışsa kesin çözer.
    chrome.runtime.reload();
  });

  async function runDiagnose() {
    const btn = $('#diagBtn');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Çalışıyor…';
    try {
      const res = await send({ type: P.HELPER_DIAG });
      const box = $('#diagBox');
      const text =
        res && res.diag ? JSON.stringify(res.diag, null, 2) : 'yanıt yok / hata: ' + JSON.stringify(res);
      box.style.display = 'block';
      $('#diagText').value = text;
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  $('#diagBtn').addEventListener('click', () => {
    runDiagnose();
  });

  $('#diagCopyBtn').addEventListener('click', async () => {
    const ta = $('#diagText');
    ta.select();
    let ok = false;
    try {
      await navigator.clipboard.writeText(ta.value);
      ok = true;
    } catch {
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
    }
    flashMsg(ok ? 'Tanı raporu kopyalandı ✓' : 'Kopyalanamadı; metni seçip Ctrl+C yapın.', ok ? 'ok' : 'bad');
  });

  $('#checkBtn').addEventListener('click', (e) => {
    e.target.disabled = true;
    checkHelper(true).finally(() => {
      e.target.disabled = false;
    });
  });

  $('#installBtn').addEventListener('click', (e) => {
    e.target.disabled = true;
    downloadPair('FoxDownloader-Yardimci-Kur', $('#installMsg')).finally(() => {
      e.target.disabled = false;
    });
  });

  $('#uninstallBtn').addEventListener('click', (e) => {
    e.target.disabled = true;
    downloadPair('FoxDownloader-Yardimci-Kaldir', $('#installMsg')).finally(() => {
      e.target.disabled = false;
    });
  });

  $('#concurrency').addEventListener('change', (e) => saveSettings({ concurrency: Number(e.target.value) }));
  $('#autoRetry').addEventListener('change', (e) => saveSettings({ autoRetry: e.target.checked }));
  $('#helperDir').addEventListener('change', (e) => saveSettings({ helperDir: e.target.value }));
  $('#helperCookies').addEventListener('change', (e) => saveSettings({ helperCookies: e.target.value }));

  $('#version').textContent = chrome.runtime.getManifest().version;

  loadSettings();
  checkHelper(true);
})();
