// src/background/helper.js köprüsü: boşta kalınca kapatılan bağlantıdan sonra
// yeni istekler yeni bir port açmalı (Chrome, disconnect() çağıran tarafa
// onDisconnect göndermez; eski port kullanılırsa "disconnected port" hatası).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const ports = [];

// Chrome'un native port davranışını taklit eder.
function fakePort() {
  const msgListeners = [];
  const port = {
    disconnected: false,
    sent: [],
    onMessage: { addListener: (fn) => msgListeners.push(fn) },
    onDisconnect: { addListener() {} },
    postMessage(payload) {
      if (this.disconnected) throw new Error('Attempting to use a disconnected port object');
      this.sent.push(payload);
      const [cmd, id] = String(payload).split('|');
      if (cmd === 'hello') {
        queueMicrotask(() => msgListeners.forEach((fn) => fn({ ev: 'hello', id, v: 2, ytdlp: 1, ffmpeg: 1, deno: 1 })));
      }
    },
    disconnect() {
      this.disconnected = true; // onDisconnect bilerek tetiklenmez
    }
  };
  ports.push(port);
  return port;
}

globalThis.chrome = {
  runtime: {
    connectNative: () => fakePort(),
    getPlatformInfo() {},
    lastError: null
  }
};

mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
const helper = await import('../src/background/helper.js');

test('boşta kapanan bağlantıdan sonra yeni port açılır', async () => {
  const first = await helper.getStatus(true);
  assert.equal(first.ok, true);
  assert.equal(first.deno, true);
  assert.equal(ports.length, 1);

  // 15 sn boşta → köprü bağlantıyı kendisi kapatır.
  mock.timers.tick(16000);
  assert.equal(ports[0].disconnected, true);

  // Önbelleği atlayıp tekrar sor: eski port kullanılırsa hata fırlatırdı.
  const second = await helper.getStatus(true);
  assert.equal(second.ok, true, 'ikinci istek başarısız: ' + JSON.stringify(second));
  assert.equal(ports.length, 2, 'yeni port açılmalı');
});

test('iptal, kapanmış bağlantıda hata fırlatmaz', () => {
  mock.timers.tick(16000);
  assert.doesNotThrow(() => helper.cancelDownload('x1'));
  assert.ok(ports.at(-1).sent.includes('cancel|x1'));
});
