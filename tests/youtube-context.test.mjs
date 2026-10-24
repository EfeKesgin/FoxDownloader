// YouTube adres ayrıştırma (video, Shorts, oynatma listesi) testleri.
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/common/protocol.js');
await import('../src/common/utils.js');
await import('../src/content/extractors/youtube.js');
const yt = globalThis.VD.extractors.youtube;

test('izleme sayfası', () => {
  const ctx = yt.getContext('https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.equal(ctx.videoId, 'jNQXAC9IVRw');
  assert.equal(ctx.listId, null);
  assert.equal(ctx.key, 'yt:jNQXAC9IVRw');
});

test('kısa bağlantı, Shorts, embed ve canlı', () => {
  assert.equal(yt.getContext('https://youtu.be/jNQXAC9IVRw?t=3').videoId, 'jNQXAC9IVRw');
  assert.equal(yt.getContext('https://www.youtube.com/shorts/abcDEF12345').videoId, 'abcDEF12345');
  assert.equal(yt.getContext('https://www.youtube.com/embed/abcDEF12345').videoId, 'abcDEF12345');
  assert.equal(yt.getContext('https://www.youtube.com/live/abcDEF12345').videoId, 'abcDEF12345');
});

test('liste içinde izlenen video: hem video hem liste kimliği', () => {
  const ctx = yt.getContext('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLabc_DEF-123&index=2');
  assert.equal(ctx.videoId, 'jNQXAC9IVRw');
  assert.equal(ctx.listId, 'PLabc_DEF-123');
  assert.notEqual(ctx.key, 'yt:jNQXAC9IVRw', 'liste bağlamı önbellek anahtarını değiştirmeli');
});

test('liste sayfası: video kimliği yok', () => {
  const ctx = yt.getContext('https://www.youtube.com/playlist?list=PLabc_DEF-123');
  assert.equal(ctx.videoId, null);
  assert.equal(ctx.listId, 'PLabc_DEF-123');
  assert.equal(ctx.key, 'ytpl:PLabc_DEF-123');
});

test('geçersiz liste kimliği yok sayılır', () => {
  assert.equal(yt.getContext('https://www.youtube.com/playlist?list=<script>'), null);
  assert.equal(yt.getContext('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=a%20b').listId, null);
});

test('video olmayan sayfalar', () => {
  assert.equal(yt.getContext('https://www.youtube.com/'), null);
  assert.equal(yt.getContext('https://www.youtube.com/@jawed'), null);
  assert.equal(yt.getContext('https://www.youtube.com/watch'), null);
});
