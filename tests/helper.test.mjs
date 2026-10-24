// ythelper.exe entegrasyon testi (yalnızca Windows): kaynak derlenir, native
// messaging çerçevesiyle konuşulur. yt-dlp olmadan da doğrulanabilenleri sınar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csc = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const skip = process.platform !== 'win32' || !existsSync(csc) ? 'yalnızca Windows (.NET csc.exe)' : false;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s) => Buffer.from(s || '', 'base64').toString('utf8');

function compile() {
  const dir = mkdtempSync(join(tmpdir(), 'fox-helper-'));
  const exe = join(dir, 'ythelper.exe');
  const r = spawnSync(
    csc,
    ['/nologo', '/optimize+', '/target:exe', '/out:' + exe, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', join(root, 'helper', 'src', 'ythelper.cs')],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, 'derleme başarısız:\n' + r.stdout + r.stderr);
  return exe;
}

// Komutları gönderir; her biri için bir olay bekler, sonra "quit" ile kapatır.
function talk(exe, commands) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    const events = [];
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error('zaman aşımı; gelen olaylar: ' + JSON.stringify(events)));
    }, 20000);
    const send = (str) => {
      const json = Buffer.from(JSON.stringify(str), 'utf8');
      const len = Buffer.alloc(4);
      len.writeUInt32LE(json.length);
      p.stdin.write(Buffer.concat([len, json]));
    };
    p.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const n = buf.readUInt32LE(0);
        if (buf.length < 4 + n) break;
        events.push(JSON.parse(buf.subarray(4, 4 + n).toString('utf8')));
        buf = buf.subarray(4 + n);
        if (events.length === commands.length) send('quit');
      }
    });
    p.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, events });
    });
    for (const c of commands) send(c);
  });
}

test('yardımcı: hello sürümü ve araç bilgisi', { skip }, async () => {
  const exe = compile();
  const { code, events } = await talk(exe, ['hello|h1']);
  assert.equal(code, 0);
  const hello = events[0];
  assert.equal(hello.ev, 'hello');
  assert.equal(hello.id, 'h1');
  assert.equal(hello.v, 2);
  assert.equal(hello.ytdlp, 0, 'geçici klasörde yt-dlp yok');
  assert.ok('deno' in hello && 'ffmpeg' in hello);
  assert.equal(unb64(hello.exe), dirname(exe));
});

test('yardımcı: eksik/bozuk indirme istekleri net hata verir', { skip }, async () => {
  const exe = compile();
  const { events } = await talk(exe, [
    'dl|d1|' + b64('b') + '|' + b64('bu bir adres degil') + '|' + b64('ad'),
    'dl|d2|' + b64('b') + '|' + b64('https://example.com/v') + '|' + b64('ad') + '||' + '|' + b64('pl,mp3'),
    'upd|u1'
  ]);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId.d1.ev, 'err');
  assert.equal(byId.d1.code, -3);
  assert.equal(byId.d2.ev, 'err');
  assert.equal(byId.d2.code, -2, 'yt-dlp.exe yok');
  assert.equal(byId.u1.ev, 'upd');
  assert.equal(byId.u1.ok, 0);
  assert.match(unb64(byId.u1.m), /bulunamadı/);
});

test('yardımcı: kimlikteki güvenli olmayan karakterler ayıklanır', { skip }, async () => {
  const exe = compile();
  const { events } = await talk(exe, ['hello|a"b\\c<d>e']);
  assert.equal(events[0].id, 'abcde');
});
