// YouTube yardımcısı köprüsü: native messaging (com.foxdownloader.ythelper).
//
// Yardımcı, tarayıcı tarafından yalnızca gerektiğinde başlatılır ve bağlantı
// kapatıldığında süreç tamamen kapanır (boşta RAM kullanımı ~0).
//
// Protokol (ythelper.exe ile): "komut|kimlik|base64Alan..." biçiminde tek JSON
// dizesi; yanıtlar {"ev":...,"id":...} nesneleridir. Ayrıntılar: helper/src/ythelper.cs

const HOST = 'com.foxdownloader.ythelper';
const STATUS_TTL_MS = 60000;
const IDLE_DISCONNECT_MS = 15000;
const DEFAULT_TIMEOUT_MS = 15000;

let port = null;
let status = null;
let statusAt = 0;
let idleTimer = null;
let keepAliveTimer = null;
let seq = 0;
const pending = new Map();
const activeDl = new Set();
const subscribers = new Set();

function debug() {
  // hata ayıklama gerekirse: console.debug('[helper]', ...arguments);
}

// ---------- kodlama ----------

function b64(str) {
  const bytes = new TextEncoder().encode(String(str == null ? '' : str));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function unb64(str) {
  try {
    const bin = atob(String(str || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------- bağlantı ----------

function ensurePort() {
  if (port) return port;
  const p = chrome.runtime.connectNative(HOST);
  p.onMessage.addListener(onMessage);
  p.onDisconnect.addListener(onDisconnect);
  port = p;
  return p;
}

function onDisconnect() {
  let message = 'YARDIMCI_BAGLANTISI_KAPANDI';
  try {
    if (chrome.runtime.lastError && chrome.runtime.lastError.message) {
      message = chrome.runtime.lastError.message;
    }
  } catch {
    // yoksay
  }
  port = null;
  status = null;
  statusAt = 0;
  for (const entry of pending.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.reject(new Error(message));
  }
  pending.clear();
  for (const id of activeDl) {
    dispatch({ ev: 'err', id, error: message });
  }
  activeDl.clear();
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  updateKeepAlive();
}

function touch() {
  if (idleTimer) clearTimeout(idleTimer);
  updateKeepAlive();
  if (!port) return;
  idleTimer = setTimeout(maybeDisconnect, IDLE_DISCONNECT_MS);
}

// İş sürerken service worker'ı uyanık tutar: worker uykuya geçerse native port
// kapanır ve yt-dlp süreçleri öldürülür. Her 20 sn'de bir zararsız bir API
// çağrısı, 30 sn'lik boşta kalma sayacını sıfırlar.
function updateKeepAlive() {
  const needed = pending.size > 0 || activeDl.size > 0;
  if (needed && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => {
      try {
        chrome.runtime.getPlatformInfo(() => {});
      } catch {
        // yoksay
      }
    }, 20000);
  } else if (!needed && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function maybeDisconnect() {
  idleTimer = null;
  if (pending.size || activeDl.size) {
    touch();
    return;
  }
  if (port) {
    try {
      port.disconnect();
    } catch {
      // yoksay
    }
  }
}

function resolvePending(id, value) {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  if (entry.timer) clearTimeout(entry.timer);
  updateKeepAlive();
  entry.resolve(value);
  return true;
}

function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  touch();
  const ev = msg.ev;
  const id = typeof msg.id === 'string' ? msg.id : '';

  if (ev === 'p') {
    if (id) {
      dispatch({ ev: 'p', id, d: toNum(msg.d), t: toNum(msg.t), s: toNum(msg.s), e: toNum(msg.e) });
    }
    return;
  }

  if (ev === 'start') {
    if (id) activeDl.add(id);
    updateKeepAlive();
    resolvePending(id, msg);
    dispatch({ ev: 'start', id });
    return;
  }

  if (ev === 'done') {
    if (id) activeDl.delete(id);
    updateKeepAlive();
    resolvePending(id, msg);
    dispatch({ ev: 'done', id, file: msg.f ? unb64(msg.f) : '', bytes: toNum(msg.bytes) });
    return;
  }

  if (ev === 'err') {
    if (id) activeDl.delete(id);
    updateKeepAlive();
    resolvePending(id, msg);
    dispatch({ ev: 'err', id, error: msg.m ? unb64(msg.m) : 'YARDIMCI_HATASI', code: toNum(msg.code) });
    return;
  }

  if (ev === 'canceled') {
    if (id) activeDl.delete(id);
    updateKeepAlive();
    dispatch({ ev: 'canceled', id });
    return;
  }

  // hello / ver / reveal gibi doğrudan yanıtlar
  if (ev === 'hello') {
    status = {
      ok: !!msg.ytdlp,
      ytdlp: !!msg.ytdlp,
      ffmpeg: !!msg.ffmpeg,
      dir: msg.dir ? unb64(msg.dir) : '',
      exe: msg.exe ? unb64(msg.exe) : '',
      ytdlpV: msg.ytdlpV ? unb64(msg.ytdlpV) : '',
      at: Date.now(),
      error: msg.ytdlp ? null : 'YT_DLP_YOK'
    };
    statusAt = Date.now();
    resolvePending(id, msg);
    return;
  }

  resolvePending(id, msg);
}

function dispatch(event) {
  debug(event);
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      // yoksay
    }
  }
}

export function onHelperEvent(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// ---------- komutlar ----------

function request(cmd, fields, opts = {}) {
  let p;
  try {
    p = ensurePort();
  } catch (err) {
    return Promise.reject(new Error(String((err && err.message) || err)));
  }
  const id = opts.id || 'c' + (++seq);
  const args = Array.isArray(fields) ? fields : [];
  const payload = cmd + '|' + id + (args.length ? '|' + args.map((f) => b64(f)).join('|') : '');
  const timeoutMs = opts.timeoutMs == null ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;

  return new Promise((resolve, reject) => {
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('YARDIMCI_ZAMAN_ASIMI'));
      }, timeoutMs);
    }
    pending.set(id, { resolve, reject, timer });
    try {
      p.postMessage(payload);
    } catch (err) {
      pending.delete(id);
      if (timer) clearTimeout(timer);
      reject(new Error(String((err && err.message) || err)));
    }
    touch();
  });
}

// Yardımcı durumu: kurulu mu, yt-dlp/ffmpeg var mı, varsayılan klasör.
export async function getStatus(force = false) {
  if (!force && status && Date.now() - statusAt < STATUS_TTL_MS) return status;
  if (force) {
    status = null;
    statusAt = 0;
  }
  try {
    await request('hello', [], { timeoutMs: 8000 });
  } catch (err) {
    const raw = String((err && err.message) || err);
    const notInstalled =
      /not found|forbidden|Access to the specified/i.test(raw) || raw === 'YARDIMCI_BAGLANTISI_KAPANDI';
    status = {
      ok: false,
      ytdlp: false,
      ffmpeg: false,
      dir: '',
      exe: '',
      ytdlpV: '',
      at: Date.now(),
      error: notInstalled ? 'YARDIMCI_KURULU_DEGIL' : raw,
      detail: raw
    };
    statusAt = Date.now();
  }
  return status;
}

export function clearStatusCache() {
  status = null;
  statusAt = 0;
}

// yt-dlp sürümünü canlı sorgular (ilk çağrı yavaş olabilir: AV taraması).
export async function getVersion() {
  try {
    const res = await request('ver', [], { timeoutMs: 180000 });
    return res && res.v ? unb64(res.v) : '';
  } catch {
    return '';
  }
}

// İndirme başlatır; tamamlanma/ilerleme olayları onHelperEvent ile gelir.
export async function startDownload(input) {
  const st = await getStatus();
  if (!st.ok) throw new Error(st.error === 'YT_DLP_YOK' ? 'YT_DLP_YOK' : 'YARDIMCI_KURULU_DEGIL');
  // DİKKAT: kimlik yalnızca opts.id ile gider; alan listesine kimlik EKLENMEZ,
  // aksi halde tüm alanlar bir sağa kayar (shim: dl|id|secici|url|ad|dizin|çerez).
  await request(
    'dl',
    [input.selector || 'bv*+ba/b', input.url, input.name || 'video', input.dir || '', input.cookies || ''],
    { id: input.id, timeoutMs: 30000 }
  );
}

export function cancelDownload(id) {
  activeDl.delete(id);
  try {
    ensurePort().postMessage('cancel|' + id);
    touch();
  } catch {
    // yoksay
  }
}

export async function reveal(filePath) {
  try {
    const res = await request('reveal', [filePath], { timeoutMs: 8000 });
    return !!(res && res.ok);
  } catch {
    return false;
  }
}

// Klasör seçme penceresi açar (yardımcı süreci üzerinden). Kullanıcı pencereyi
// kapatana kadar bekler; iptal edilirse boş dize döner.
export async function pickDir(initial) {
  const res = await request('pickdir', [initial || ''], { timeoutMs: 600000 });
  return res && res.p ? unb64(res.p) : '';
}

// Tanı: bağlantıyı ham olarak dener ve raporlar (kullanıcı desteğe gönderir).
export async function diagnose() {
  const report = {
    zaman: new Date().toISOString(),
    host: HOST,
    eklentiKimligi: '',
    surum: '',
    durum: null,
    canliDeneme: null
  };
  try {
    report.eklentiKimligi = chrome.runtime.id;
  } catch {
    // yoksay
  }
  try {
    report.surum = chrome.runtime.getManifest().version;
  } catch {
    // yoksay
  }
  try {
    const st = await getStatus(true);
    report.durum = st ? { ok: st.ok, error: st.error, detail: st.detail || '', dir: st.dir } : null;
  } catch (err) {
    report.durum = { hata: String((err && err.message) || err) };
  }

  // Ana bağlantıyı kapat; ham deneme temiz bir port kullansın.
  try {
    if (port) port.disconnect();
  } catch {
    // yoksay
  }

  try {
    const p = chrome.runtime.connectNative(HOST);
    report.canliDeneme = await new Promise((resolve) => {
      let done = false;
      const bitir = (v) => {
        if (done) return;
        done = true;
        try {
          p.disconnect();
        } catch {
          // yoksay
        }
        resolve(v);
      };
      const t = setTimeout(() => bitir({ ok: false, hata: 'yanıt yok (8 sn)' }), 8000);
      p.onMessage.addListener((m) => {
        clearTimeout(t);
        bitir({ ok: true, yanit: m });
      });
      p.onDisconnect.addListener(() => {
        clearTimeout(t);
        let msg = '(mesaj yok)';
        try {
          if (chrome.runtime.lastError && chrome.runtime.lastError.message) {
            msg = chrome.runtime.lastError.message;
          }
        } catch {
          // yoksay
        }
        bitir({ ok: false, hata: msg });
      });
      try {
        p.postMessage('hello|diag1');
      } catch (err) {
        clearTimeout(t);
        bitir({ ok: false, hata: 'gönderilemedi: ' + String((err && err.message) || err) });
      }
    });
  } catch (err) {
    report.canliDeneme = { ok: false, hata: String((err && err.message) || err) };
  }
  return report;
}

export function activeCount() {
  return activeDl.size;
}
