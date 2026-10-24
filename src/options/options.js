// Ayarlar sayfası: yardımcı durumu/güncelleme + indirme ayarları.
(() => {
  const P = globalThis.VD_PROTOCOL;

  const $ = (sel) => document.querySelector(sel);
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  // Teşhis: durum kutusunda hangi yapının çalıştığını gösterir.
  const MANIFEST = chrome.runtime.getManifest();

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- yardımcı durumu ----------

  function setComp(id, state, text) {
    const el = $(id);
    el.className = 'comp ' + state;
    el.querySelector('.cval').textContent = text;
  }

  function renderStatus(st) {
    const el = $('#helperStatus');
    const comps = $('#components');
    if (!st) {
      el.className = 'status bad';
      el.innerHTML = '<b>✗ Durum okunamadı</b><div class="sub">Arka plan betiğine ulaşılamadı; eklentiyi yeniden yükleyin.</div>';
      comps.hidden = true;
      return;
    }
    if (!st.ok) {
      comps.hidden = true;
      if (st.error === 'YT_DLP_YOK') {
        el.className = 'status warn';
        el.innerHTML = '<b>⚠ Yardımcı var ama yt-dlp.exe eksik</b><div class="sub">FoxDownloader-Kur.exe\'yi yeniden çalıştırın.</div>';
        return;
      }
      el.className = 'status bad';
      el.innerHTML =
        '<b>✗ Yardımcı kurulu değil</b>' +
        '<div class="sub">FoxDownloader-Kur.exe\'yi çalıştırın, ardından tarayıcıyı yeniden başlatıp burada "Yeniden kontrol et"e basın.</div>' +
        (st.detail ? '<div class="sub"><code>' + escapeHtml(String(st.detail)) + '</code></div>' : '');
      return;
    }

    const old = st.helperV < 2;
    const problems = [];
    if (old) problems.push('Yardımcı eski sürüm: Deno, otomatik güncelleme ve yeni seçenekler için FoxDownloader-Kur.exe\'yi yeniden çalıştırın.');
    else if (!st.deno) problems.push('Deno bulunamadı: YouTube\'da bazı kaliteler eksik çıkabilir. Kurulumu yeniden çalıştırın.');
    if (!st.ffmpeg) problems.push('FFmpeg yok: en fazla 720p iner, MP3 ve gömme seçenekleri çalışmaz. Kurulumda FFmpeg seçeneğini işaretleyin.');

    el.className = 'status ' + (problems.length ? 'warn' : 'ok');
    el.innerHTML =
      (problems.length ? '<b>⚠ Yardımcı kurulu, ama eksikler var</b>' : '<b>✓ Her şey hazır</b>') +
      problems.map((p) => '<div class="sub">' + escapeHtml(p) + '</div>').join('') +
      '<div class="sub">Hedef klasör: <code>' + escapeHtml(st.dir || '(varsayılan)') + '</code></div>';

    comps.hidden = false;
    setComp('#compHelper', old ? 'warn' : 'ok', old ? 'Eski sürüm' : 'Kurulu');
    setComp('#compYtdlp', 'ok', st.ytdlpV || 'kurulu');
    setComp('#compDeno', st.deno ? 'ok' : old ? 'warn' : 'bad', st.deno ? 'Var' : old ? 'Bilinmiyor' : 'Yok');
    setComp('#compFfmpeg', st.ffmpeg ? 'ok' : 'warn', st.ffmpeg ? 'Var' : 'Yok');

    const dirInput = $('#helperDir');
    if (dirInput && st.dir) dirInput.placeholder = 'Boş = ' + st.dir;
    $('#updateBtn').disabled = old;
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
      setComp('#compYtdlp', 'ok', 'sorgulanıyor…');
      const v = await send({ type: P.HELPER_VERSION });
      setComp('#compYtdlp', 'ok', (v && v.version) || 'kurulu');
    }
  }

  // ---------- yt-dlp güncelleme ----------

  function formatWhen(ts) {
    if (!ts) return 'henüz kontrol edilmedi';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'az önce';
    if (diff < 3600000) return Math.round(diff / 60000) + ' dk önce';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' saat önce';
    return Math.round(diff / 86400000) + ' gün önce';
  }

  function renderUpdateInfo(update) {
    const el = $('#updateInfo');
    if (!update) return;
    if (update.running) {
      el.textContent = 'Güncelleniyor…';
      return;
    }
    let text = 'Son kontrol: ' + formatWhen(update.checkedAt);
    if (update.checkedAt && update.ok === false && update.message) text += ' • ' + update.message;
    el.textContent = text + '. Haftada bir ve bir indirme hata verdiğinde kontrol edilir.';
  }

  async function runUpdate() {
    const btn = $('#updateBtn');
    const msg = $('#updateMsg');
    btn.disabled = true;
    btn.textContent = 'Güncelleniyor…';
    msg.className = 'msg';
    msg.textContent = 'yt-dlp güncellemesi kontrol ediliyor (birkaç saniye sürer)…';
    try {
      const res = await send({ type: P.YTDLP_UPDATE });
      const r = res && res.result;
      if (r && r.ok) {
        msg.className = 'msg ok';
        msg.textContent = r.changed ? '✓ yt-dlp ' + r.version + ' sürümüne güncellendi.' : '✓ yt-dlp zaten güncel (' + r.version + ').';
        if (r.version) setComp('#compYtdlp', 'ok', r.version);
      } else {
        msg.className = 'msg bad';
        const m = (r && r.message) || 'bilinmeyen hata';
        msg.textContent =
          m === 'YARDIMCI_ESKI'
            ? 'Yardımcı eski sürüm; önce FoxDownloader-Kur.exe\'yi yeniden çalıştırın.'
            : 'Güncellenemedi: ' + m;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Şimdi güncelle';
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
        'İndirilenler klasörüne <code>' + escapeHtml(base + '.cmd') + '</code> ve <code>' +
        escapeHtml(base + '.ps1') + '</code> indirildi. Şimdi <b>' + escapeHtml(base + '.cmd') +
        '</b> dosyasına çift tıklayın (iki dosya aynı klasörde kalmalı).';
    } catch (err) {
      msgEl.className = 'msg bad';
      msgEl.textContent = 'İndirilemedi: ' + String((err && err.message) || err);
    }
  }

  // ---------- ayarlar ----------

  const CHECKBOXES = ['autoRetry', 'autoUpdate', 'embedSubs', 'embedThumb', 'embedMeta'];

  async function loadSettings() {
    const res = await send({ type: P.GET_QUEUE });
    const s = (res && res.settings) || {};
    $('#concurrency').value = String(s.concurrency || 3);
    $('#helperDir').value = s.helperDir || '';
    $('#helperCookies').value = s.helperCookies || '';
    for (const key of CHECKBOXES) {
      // autoRetry/autoUpdate varsayılan açık, gömme seçenekleri varsayılan kapalı
      $('#' + key).checked = key === 'autoRetry' || key === 'autoUpdate' ? s[key] !== false : !!s[key];
    }
    renderUpdateInfo(res && res.update);
  }

  let msgTimer = null;
  function flashMsg(text, kind) {
    const el = $('#settingsMsg');
    el.className = 'msg ' + (kind || 'ok');
    el.textContent = text;
    if (msgTimer) clearTimeout(msgTimer);
    msgTimer = setTimeout(() => {
      el.textContent = '';
      el.className = 'msg';
    }, 2600);
  }

  async function saveSettings(patch) {
    await send({ type: P.SET_SETTINGS, settings: patch });
    flashMsg('Kaydedildi ✓', 'ok');
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

  // ---------- tanı ----------

  async function runDiagnose() {
    const btn = $('#diagBtn');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Çalışıyor…';
    try {
      const res = await send({ type: P.HELPER_DIAG });
      $('#diagBox').hidden = false;
      $('#diagText').value =
        res && res.diag ? JSON.stringify(res.diag, null, 2) : 'yanıt yok / hata: ' + JSON.stringify(res);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function copyDiagnose() {
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
  }

  // ---------- bağlama ----------

  function withDisabled(btn, fn) {
    btn.disabled = true;
    Promise.resolve(fn()).finally(() => {
      btn.disabled = false;
    });
  }

  $('#browseDirBtn').addEventListener('click', () => pickFolder());
  // Diskteki son sürümü yükler; tarayıcı belleğinde eski kod kalmışsa kesin çözer.
  $('#reloadExtBtn').addEventListener('click', () => chrome.runtime.reload());
  $('#diagBtn').addEventListener('click', () => runDiagnose());
  $('#diagCopyBtn').addEventListener('click', () => copyDiagnose());
  $('#updateBtn').addEventListener('click', () => runUpdate());
  $('#checkBtn').addEventListener('click', (e) => withDisabled(e.target, () => checkHelper(true)));
  $('#installBtn').addEventListener('click', (e) =>
    withDisabled(e.target, () => downloadPair('FoxDownloader-Yardimci-Kur', $('#installMsg')))
  );
  $('#uninstallBtn').addEventListener('click', (e) =>
    withDisabled(e.target, () => downloadPair('FoxDownloader-Yardimci-Kaldir', $('#installMsg')))
  );

  $('#concurrency').addEventListener('change', (e) => saveSettings({ concurrency: Number(e.target.value) }));
  $('#helperDir').addEventListener('change', (e) => saveSettings({ helperDir: e.target.value }));
  $('#helperCookies').addEventListener('change', (e) => saveSettings({ helperCookies: e.target.value }));
  for (const key of CHECKBOXES) {
    $('#' + key).addEventListener('change', (e) => saveSettings({ [key]: e.target.checked }));
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === P.QUEUE_UPDATE) renderUpdateInfo(msg.update);
  });

  $('#version').textContent = MANIFEST.version;
  $('#version2').textContent = MANIFEST.version;

  loadSettings();
  checkHelper(true);
})();
