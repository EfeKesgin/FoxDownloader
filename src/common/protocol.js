// Mesaj protokolü: service worker, content script ve popup tarafından paylaşılır.
// Klasik script olarak da (content script), modül importu ile de (SW) çalışır.
globalThis.VD_PROTOCOL = Object.freeze({
  // content -> background
  TAB_HELLO: 'vd:tab-hello',
  TAB_VIDEO: 'vd:tab-video',
  GET_SNIFFED: 'vd:get-sniffed',
  ENQUEUE: 'vd:enqueue',
  FETCH_YT_PLAYER: 'vd:fetch-yt-player',
  FETCH_PAGE: 'vd:fetch-page',
  FETCH_TWEET_MEDIA: 'vd:fetch-tweet-media',

  // popup -> background
  GET_QUEUE: 'vd:get-queue',
  PAUSE_ITEM: 'vd:pause-item',
  RESUME_ITEM: 'vd:resume-item',
  CANCEL_ITEM: 'vd:cancel-item',
  REMOVE_ITEM: 'vd:remove-item',
  RETRY_ITEM: 'vd:retry-item',
  CLEAR_FINISHED: 'vd:clear-finished',
  GET_SETTINGS: 'vd:get-settings',
  SET_SETTINGS: 'vd:set-settings',

  // popup -> content
  GET_PAGE_FORMATS: 'vd:get-page-formats',

  // background -> content (sayfa içi indirme hattı)
  DOWNLOAD_IN_PAGE: 'vd:download-in-page',
  DOWNLOAD_CANCEL_IN_PAGE: 'vd:download-cancel-in-page',

  // content -> background
  DOWNLOAD_PROGRESS: 'vd:download-progress',
  DOWNLOAD_DONE: 'vd:download-done',

  // YouTube yardımcısı (native messaging) durumu
  HELPER_STATUS: 'vd:helper-status',
  HELPER_VERSION: 'vd:helper-version',
  // yt-dlp'yi şimdi güncelle (yt-dlp -U)
  YTDLP_UPDATE: 'vd:ytdlp-update',
  // tamamlanan indirmeyi klasörde göster
  REVEAL_ITEM: 'vd:reveal-item',
  // klasör seçme penceresi (yardımcı açısından)
  PICK_DIR: 'vd:pick-dir',
  // bağlantı tanı raporu (destek/troubleshooting)
  HELPER_DIAG: 'vd:helper-diag',
  // seçenekler sayfasını aç
  OPEN_OPTIONS: 'vd:open-options',

  // background -> herkese (broadcast)
  QUEUE_UPDATE: 'vd:queue-update'
});
