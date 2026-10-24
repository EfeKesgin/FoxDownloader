// src/common/utils.js birim testleri. Çalıştırma: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/common/utils.js');
const U = globalThis.VD_UTILS;

test('sanitizeFilename: Windows için yasak karakterleri boşluğa çevirir', () => {
  assert.equal(U.sanitizeFilename('a<b>c:d"e/f\\g|h?i*j'), 'a b c d e f g h i j');
  assert.equal(U.sanitizeFilename('  ..gizli dosya..  '), 'gizli dosya');
  assert.equal(U.sanitizeFilename('satır\nsonu\ttab'), 'satır sonu tab');
});

test('sanitizeFilename: boş ya da yalnızca geçersiz girdide "video" döner', () => {
  assert.equal(U.sanitizeFilename(''), 'video');
  assert.equal(U.sanitizeFilename(null), 'video');
  assert.equal(U.sanitizeFilename('???'), 'video');
});

test('sanitizeFilename: uzunluk sınırına uyar', () => {
  assert.equal(U.sanitizeFilename('x'.repeat(500)).length, 120);
  assert.equal(U.sanitizeFilename('x'.repeat(500), 20).length, 20);
});

test('sanitizeFilename: yüzde işaretine dokunmaz (yardımcı kendisi kaçışlar)', () => {
  assert.equal(U.sanitizeFilename('%100 indirim %(id)s'), '%100 indirim %(id)s');
});

test('buildName / buildFilename: "Yazar - Başlık [kalite]"', () => {
  assert.equal(U.buildName({ author: 'Kanal', title: 'Video', tag: '1080p' }), 'Kanal - Video [1080p]');
  assert.equal(U.buildName({ title: 'Liste' , tag: 'mp3' }), 'Liste [mp3]');
  assert.equal(U.buildFilename({ author: 'A', title: 'B', tag: '720p', ext: 'mp4' }), 'A - B [720p].mp4');
  assert.equal(U.buildFilename({ title: 'B', ext: '.webm' }), 'B.webm');
});

test('formatBytes / formatSpeed / formatDuration / formatBitrate', () => {
  assert.equal(U.formatBytes(0), '');
  assert.equal(U.formatBytes(512), '512 B');
  assert.equal(U.formatBytes(1536), '1.50 KB');
  assert.equal(U.formatBytes(150 * 1024 * 1024), '150 MB');
  assert.equal(U.formatSpeed(2048), '2.00 KB/s');
  assert.equal(U.formatDuration(59), '0:59');
  assert.equal(U.formatDuration(3725), '1:02:05');
  assert.equal(U.formatBitrate(128000), '128 kbps');
  assert.equal(U.formatBitrate(2500000), '2.5 Mbps');
});

test('extractBalancedJson: iç içe nesne ve dize içindeki süslü parantezler', () => {
  const html = 'var x = 1; var ytInitialPlayerResponse = {"a":{"b":"}{"},"c":[1,{"d":2}]};var y={};';
  assert.equal(U.extractBalancedJson(html, 'ytInitialPlayerResponse'), '{"a":{"b":"}{"},"c":[1,{"d":2}]}');
  assert.deepEqual(U.parseEmbeddedJson(html, 'ytInitialPlayerResponse'), { a: { b: '}{' }, c: [1, { d: 2 }] });
  assert.equal(U.extractBalancedJson('yok', 'ytInitialPlayerResponse'), null);
  assert.equal(U.parseEmbeddedJson('m = {bozuk', 'm'), null);
});

test('parseItagFromCipher: signatureCipher içinden itag', () => {
  const url = encodeURIComponent('https://r1.googlevideo.com/videoplayback?itag=137&mime=video%2Fmp4');
  assert.equal(U.parseItagFromCipher('s=abc&sp=sig&url=' + url), 137);
  assert.equal(U.parseItagFromCipher('s=abc'), null);
});

test('stripRangeParams: range/rn/rbuf parametrelerini siler', () => {
  const out = U.stripRangeParams('https://x.googlevideo.com/videoplayback?itag=18&range=0-100&rn=3&rbuf=0');
  assert.equal(out, 'https://x.googlevideo.com/videoplayback?itag=18');
});

test('isHttpUrl: yalnızca http(s)', () => {
  assert.equal(U.isHttpUrl('https://example.com'), true);
  assert.equal(U.isHttpUrl('http://example.com/a'), true);
  assert.equal(U.isHttpUrl('file:///C:/x'), false);
  assert.equal(U.isHttpUrl('javascript:alert(1)'), false);
  assert.equal(U.isHttpUrl('bozuk'), false);
});

test('ensureArray / uuid', () => {
  assert.deepEqual(U.ensureArray(null), []);
  assert.deepEqual(U.ensureArray(1), [1]);
  assert.deepEqual(U.ensureArray([1, 2]), [1, 2]);
  const a = U.uuid();
  assert.match(a, /^[0-9a-f-]{20,}$/i);
  assert.notEqual(a, U.uuid());
});
