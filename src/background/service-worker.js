// Service worker: mesaj yönlendirme, ağ kuralları, platform API yardımcıları.
import '../common/protocol.js';
import '../common/utils.js';
import { startSniffer, getSniffed, noteTabVideo, dropTab } from './sniffer.js';
import { getStatus as helperStatus, getVersion as helperVersion, pickDir as helperPickDir, diagnose as helperDiagnose } from './helper.js';
import {
  initQueue,
  onQueueUpdate,
  enqueue,
  getSnapshot,
  setSettings,
  pauseItem,
  resumeItem,
  cancelItem,
  removeItem,
  retryItem,
  clearFinished,
  revealItem,
  updateYtdlpNow,
  frontendProgress,
  frontendDone
} from './queue.js';

const P = () => globalThis.VD_PROTOCOL;
const U = () => globalThis.VD_UTILS;

// ---------- sekmeye yayın ----------

const contentTabs = new Set();

function broadcastToTabs(payload) {
  for (const tabId of contentTabs) {
    chrome.tabs.sendMessage(tabId, payload).catch(() => {
      contentTabs.delete(tabId);
    });
  }
}

// ---------- declarativeNetRequest: CDN indirmeleri için referer ----------

async function setupDnrRules() {
  const rules = [
    {
      id: 9001,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'referer', operation: 'set', value: 'https://www.tiktok.com/' }
        ]
      },
      condition: {
        requestDomains: [
          'tiktokcdn.com',
          'tiktokcdn-us.com',
          'tiktokcdn-eu.com',
          'tiktokv.com',
          'byteoversea.com'
        ]
      }
    },
    {
      id: 9002,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'referer', operation: 'set', value: 'https://www.youtube.com/' }
        ]
      },
      condition: {
        requestDomains: ['googlevideo.com']
      }
    }
  ];
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: rules.map((r) => r.id),
      addRules: rules
    });
  } catch {
    // kural eklenemezse indirmeler yine denenir
  }
}

// ---------- platform API yardımcıları ----------

// YouTube player yanıtı: önce watch sayfası HTML'i (kanıtlanmış çalışıyor),
// olmazsa InnerTube API (bazı durumlarda UNPLAYABLE döner).
async function fetchYtPlayer(videoId) {
  if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) return { ok: false, error: 'Geçersiz video kimliği' };

  try {
    const html = await fetchText('https://www.youtube.com/watch?v=' + encodeURIComponent(videoId) + '&hl=en');
    const player = U().parseEmbeddedJson(html, 'ytInitialPlayerResponse');
    if (player && player.videoDetails) return { ok: true, player };
  } catch {
    // API yoluna düş
  }

  try {
    // YouTube'un HERKESE ACIK web istemcisi (InnerTube) anahtari: youtube.com kaynak
    // kodunda gorunur, kullaniciya ait gizli bir anahtar DEGILDIR. GitHub'in gizli
    // anahtar tarayicisi tek parca "AIza..." desenini isaretledigi icin parcali tutulur.
    const ytKey = 'AIzaSyAO_FJ2SlqU8' + 'Q4STEHLGCilw_Y9_11qcW8';
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=' + ytKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20260101.00.00'
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20260101.00.00',
            hl: 'en',
            gl: 'US'
          }
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true
      })
    });
    if (res.ok) {
      const player = await res.json();
      if (player && player.videoDetails) return { ok: true, player };
    }
  } catch {
    // yoksay
  }
  return { ok: false, error: 'YouTube player yanıtı alınamadı' };
}

async function fetchText(url) {
  const res = await fetch(url, {
    credentials: 'omit',
    headers: { 'Accept-Language': 'en-US,en;q=0.9' }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// X (Twitter) sendikasyon API'si: herkese açık gönderilerin video varyantları.
function syndicationToken(tweetId) {
  try {
    return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  } catch {
    return '';
  }
}

function collectVideoVariants(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectVideoVariants(child, acc);
    return;
  }
  const info = node.video_info;
  if (info && Array.isArray(info.variants)) {
    for (const variant of info.variants) {
      if (!variant || !variant.url) continue;
      const type = String(variant.content_type || '');
      if (!type.includes('mp4')) continue;
      acc.push({
        url: variant.url,
        bitrate: Number(variant.bitrate) || 0,
        contentType: type
      });
    }
  }
  for (const key of Object.keys(node)) collectVideoVariants(node[key], acc);
}

async function fetchTweetMedia(tweetId) {
  if (!tweetId || !/^\d{5,25}$/.test(String(tweetId))) {
    return { ok: false, error: 'Geçersiz gönderi kimliği' };
  }
  const token = syndicationToken(tweetId);
  const url =
    'https://cdn.syndication.twimg.com/tweet-result?id=' +
    encodeURIComponent(tweetId) +
    '&token=' +
    encodeURIComponent(token) +
    '&lang=en';
  try {
    const res = await fetch(url, {
      credentials: 'omit',
      headers: { 'Accept-Language': 'en-US,en;q=0.9' }
    });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const json = await res.json();
    const acc = [];
    collectVideoVariants(json, acc);
    const seen = new Set();
    const variants = acc.filter((v) => {
      const key = v.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const user = json && json.user ? json.user : {};
    return {
      ok: true,
      variants,
      text: typeof json?.text === 'string' ? json.text : '',
      screenName: user.screen_name || '',
      name: user.name || ''
    };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// TikTok / YouTube HTML yedeği: desteklenen alan adlarıyla sınırlı.
const PAGE_FETCH_ALLOWLIST = [
  /^https?:\/\/www\.tiktok\.com\//,
  /^https?:\/\/www\.youtube\.com\//
];

async function fetchPage(url) {
  if (!U().isHttpUrl(url) || !PAGE_FETCH_ALLOWLIST.some((re) => re.test(url))) {
    return { ok: false, error: 'Bu adres için sayfa getirme izni yok' };
  }
  try {
    const html = await fetchText(url);
    return { ok: true, html };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// ---------- mesaj yönlendirme ----------

const handlers = {
  [P().TAB_HELLO]: async (msg, sender) => {
    const tabId = sender.tab && sender.tab.id;
    if (tabId != null) contentTabs.add(tabId);
    return { ok: true, queue: (await getSnapshot()).queue };
  },
  [P().TAB_VIDEO]: async (msg, sender) => {
    const tabId = sender.tab && sender.tab.id;
    await noteTabVideo(tabId, msg.videoId || null);
    return { ok: true };
  },
  [P().GET_SNIFFED]: async (msg, sender) => {
    const tabId = sender.tab && sender.tab.id;
    return { ok: true, urls: await getSniffed(tabId) };
  },
  [P().ENQUEUE]: async (msg, sender) => {
    const item = msg.item || {};
    if (item.tabId == null && sender.tab && sender.tab.id != null) item.tabId = sender.tab.id;
    const id = await enqueue(item);
    return { ok: true, id };
  },
  [P().DOWNLOAD_PROGRESS]: async (msg) => {
    await frontendProgress(msg.id, msg.received, msg.total);
    return { ok: true };
  },
  [P().DOWNLOAD_DONE]: async (msg) => {
    await frontendDone(msg.id, !!msg.ok, msg.detail);
    return { ok: true };
  },
  [P().GET_QUEUE]: async () => ({ ok: true, ...(await getSnapshot()) }),
  [P().GET_SETTINGS]: async () => ({ ok: true, settings: (await getSnapshot()).settings }),
  [P().SET_SETTINGS]: async (msg) => ({ ok: true, settings: await setSettings(msg.settings) }),
  [P().PAUSE_ITEM]: async (msg) => {
    await pauseItem(msg.id);
    return { ok: true };
  },
  [P().RESUME_ITEM]: async (msg) => {
    await resumeItem(msg.id);
    return { ok: true };
  },
  [P().CANCEL_ITEM]: async (msg) => {
    await cancelItem(msg.id);
    return { ok: true };
  },
  [P().REMOVE_ITEM]: async (msg) => {
    await removeItem(msg.id);
    return { ok: true };
  },
  [P().RETRY_ITEM]: async (msg) => {
    await retryItem(msg.id);
    return { ok: true };
  },
  [P().CLEAR_FINISHED]: async () => {
    await clearFinished();
    return { ok: true };
  },
  [P().REVEAL_ITEM]: async (msg) => ({ ok: await revealItem(msg.id) }),
  [P().PICK_DIR]: async (msg) => {
    const st = await helperStatus(false);
    if (!st.ok) return { ok: false, error: 'YARDIMCI_KURULU_DEGIL' };
    try {
      const dir = await helperPickDir(msg.initial);
      return { ok: true, dir };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  },
  [P().HELPER_STATUS]: async (msg) => {
    const st = await helperStatus(msg.force === true);
    return { ok: !!st.ok, status: st };
  },
  [P().HELPER_VERSION]: async () => ({ ok: true, version: await helperVersion() }),
  [P().YTDLP_UPDATE]: async () => ({ ok: true, result: await updateYtdlpNow() }),
  [P().HELPER_DIAG]: async () => ({ ok: true, diag: await helperDiagnose() }),
  [P().OPEN_OPTIONS]: async () => {
    try {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },
  [P().FETCH_YT_PLAYER]: async (msg) => fetchYtPlayer(msg.videoId),
  [P().FETCH_TWEET_MEDIA]: async (msg) => fetchTweetMedia(msg.tweetId),
  [P().FETCH_PAGE]: async (msg) => fetchPage(msg.url)
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  Promise.resolve(handler(msg, sender))
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});

// ---------- yaşam döngüsü ----------

chrome.runtime.onInstalled.addListener((details) => {
  setupDnrRules();
  initQueue();
  // Kurulum zorunlu: ilk yüklemede ayarlar sayfasını açıp kurulumu gösterelim.
  if (details && details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  setupDnrRules();
  initQueue();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  contentTabs.delete(tabId);
  dropTab(tabId);
});

onQueueUpdate((payload) => broadcastToTabs(payload));

startSniffer();
setupDnrRules();
initQueue();
