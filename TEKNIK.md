# FoxDownloader — Teknik Ayrıntılar 🦊

Bu dosya, [README](README.md)'deki kısa anlatımın ayrıntılı sürümüdür: neden yardımcı
gerekiyor, mimari, indirme hatları, sorun giderme ve geliştirme notları.

## Neden yardımcı (native host) gerekiyor?

YouTube 2026'da 1080p ve üzeri kaliteleri **SABR/PO-token** akışıyla tarayıcıya kapatıyor;
TikTok CDN'i ise hotlink koruması uyguluyor. Bu yüzden FoxDownloader indirmeleri
**FoxDownloader Yardımcısı** üzerinden yapar: yerel, açık kaynak `yt-dlp`'yi kullanan küçük bir
yardımcı program. Kurulum **tek seferliktir**, yönetici izni gerektirmez ve yardımcı
**yalnızca indirme sırasında** çalışır (boşta 0 MB).

## Özellikler

- **Kalite/format seçimi**: İndirmeden önce çözünürlük/kalite seçin (YouTube'da 4K'ya kadar).
- **Popup paneli**: İndirmeler buradan başlatılır — aktif sayfadaki formatlar + kuyruk ve ayarlar.
- **İndirme kuyruğu**: Eşzamanlı indirme (1–5), ilerleme yüzdesi, hız, iptal/tekrar dene.
- **Klasörde göster**: Tamamlanan indirmeyi dosya yöneticisinde açar.
- **Dosya düzeni**: `İndirilenler/Yazar - Başlık [kalite].uzantı` — **alt klasör oluşturulmaz**.
  İsterseniz Ayarlar → **Gözat…** ile hedef klasörü siz seçebilirsiniz.
- **MP4 önceliği**: YouTube'da 1080p'ye kadar MP4 (H.264+AAC); 1440p/4K'da MP4 (AV1) veya WebM.
  TikTok'ta **filigransız MP4**.

## Platform desteği (2026 gerçeği)

| Platform | Kalite | Nasıl çalışır |
|---|---|---|
| **YouTube (yardımcı)** | **360p – 4K (2160p)** + M4A ses | Yerel yardımcı (`ythelper.exe` + `yt-dlp.exe`), native messaging ile bağlanır. 1080p'ye kadar **MP4 (H.264+AAC)**, 1440p/4K'da **MP4 (AV1)** veya WebM/MKV. FFmpeg zorunludur (görüntü+ses birleştirme). |
| **TikTok (yardımcı)** | **Filigransız MP4** + MP3 ses | yt-dlp TikTok'u doğrudan çözer (gerekirse JS yoklamasını kendi geçer). Sayfadaki gömülü veriden okuyan tarayıcı içi satırlar da listede kalır, ancak TikTok CDN'i bunları bazı videolarda engeller. |
| **X (Twitter)** | 480p – 1280x720+ (bitrate varyantları) | Resmî sendikasyon API'si (`cdn.syndication.twimg.com`); giriş gerekmez. `video.twimg.com` doğrudan indirmeye açıktır (`chrome.downloads`). |

## FoxDownloader Yardımcısı (zorunlu)

- **İki yolla** kurulur: tek tıkla **`FoxDownloader-Kur.exe`** (önerilen) veya geliştirici
  kurulumunda Ayarlar sayfasından inen `FoxDownloader-Yardimci-Kur.cmd` + `.ps1`. İki yol da
  aynı betiği çalıştırır; EXE yalnızca görsel arayüzü ve eklenti klasörünü ekler.
- `%LOCALAPPDATA%\FoxDownloaderHelper` klasörüne şunları koyar:
  - `ythelper.exe` — bu eklentiye özel, yerel olarak derlenen ~19 KB'lık native messaging host'u,
  - `yt-dlp.exe` — GitHub'dan indirilen açık kaynak indirici (~18 MB),
  - `ffmpeg.exe` — görüntü+ses birleştirme için **gerekli** (~130 MB indirme; yt-dlp/FFmpeg-Builds;
    sistemde kurulu bir FFmpeg varsa indirilmez),
  - `com.foxdownloader.ythelper.json` — native messaging manifestosu.
- `HKCU\Software\...\NativeMessagingHosts\...` kayıt anahtarlarını yazar (Chrome, Chromium,
  Brave, Edge, Vivaldi, Opera). **Yönetici izni gerekmez**, sistem klasörlerine dokunmaz.
- **Hedef klasör**: boş bırakılırsa doğrudan **İndirilenler** klasörü; alt klasör açılmaz.
  Ayarlar'dan başka bir klasör seçebilirsiniz ("Gözat…" yardımcı üzerinden pencere açar).
- Kaldırma: `FoxDownloader-Kaldir.exe` veya Ayarlar → **Kaldırma dosyalarını indir** → `…-Kaldir.cmd`.

### Bellek (RAM) kullanımı

| Durum | Kullanım |
|---|---|
| Boşta (indirme yok) | **0 MB** — yardımcı süreç tamamen kapanır (bağlantı kesilince çıkar) |
| Sadece durum sorgusu | 16–17 MB, sorgu bitince kapanır |
| İndirme sırasında | `ythelper.exe` 16–20 MB + `yt-dlp.exe` tipik 40–70 MB (indirme bitince ikisi de kapanır) |

### Güvenlik / şeffaflık

- Yardımcının tüm kaynak kodu bu depoda: `helper/src/ythelper.cs` (C#) ve
  `helper/src/install.tmpl.ps1` (PowerShell kurulum). Kurulum dosyaları `devtools/build-helper.mjs`
  ile bu kaynaklardan üretilir; üretilen dosyalar `helper/` klasöründedir.
- EXE arayüzlerinin kaynakları: `installer/src/` — `devtools/build-installer.mjs` ile derlenir.
- İndirilen tek dış dosyalar `yt-dlp.exe` (GitHub Releases) ve gerekirse FFmpeg
  (yt-dlp/FFmpeg-Builds)'dir.
- `ythelper.exe` yerel olarak derlendiği (imzasız olduğu) için bazı antivirüsler yanlış
  pozitif verebilir; gerekirse klasörü dışlamalara ekleyin.
- Kodda yalnızca YouTube'un **herkese açık** web (InnerTube) anahtarı bulunur; kullanıcıya ait
  hiçbir gizli anahtar depoda tutulmaz.

## Mimari

```
src/
├── common/
│   ├── protocol.js        # Mesaj sabitleri (SW ↔ content ↔ popup ↔ options)
│   └── utils.js           # Dosya adı, biçimlendirme, JSON ayıklama yardımcıları
├── background/
│   ├── service-worker.js  # Mesaj yönlendirme, DNR kuralları, platform API'leri
│   ├── queue.js           # İndirme kuyruğu (helper + frontend + native)
│   ├── helper.js          # Yardımcı köprüsü (native messaging)
│   └── sniffer.js         # webRequest ile medya URL'lerini yakalama
├── content/
│   ├── content.js         # Platform yönlendirme, SPA takibi, indirme hattı
│   └── extractors/        # youtube.js • tiktok.js • twitter.js
├── options/               # Ayarlar sayfası (yardımcı kurulumu + ayarlar)
└── popup/                 # Araç çubuğu paneli (sayfa formatları + kuyruk)

helper/
├── src/                   # Kaynaklar (tek doğruluk kaynağı)
│   ├── ythelper.cs        # Native messaging host'u (C#)
│   ├── install.tmpl.ps1   # Kurulum betiği
│   └── uninstall.tmpl.ps1 # Kaldırma betiği
├── FoxDownloader-Yardimci-Kur.cmd / .ps1     # Üretilen kurulum dosyaları
└── FoxDownloader-Yardimci-Kaldir.cmd / .ps1  # Üretilen kaldırma dosyaları

installer/
└── src/                   # EXE arayüzleri (C#): Common.cs • FoxKur.cs • FoxKaldir.cs

icons/
└── generate-icons.ps1     # Tilki logosunu (16/32/48/128 PNG) yeniden üretir

devtools/
├── extension-id.json      # Sabit eklenti kimliği + açık anahtar (manifest "key")
├── make-extension-key.mjs # Kimlik üretir; özel anahtar .gitignore'daki dosyaya yazılır
├── build-helper.mjs       # helper/src → helper/*.cmd|.ps1 üretimi
├── build-installer.mjs    # Eklentiyi paketler → dist/FoxDownloader-Kur.exe + Kaldir.exe
└── check.mjs              # Tüm JS dosyaları için söz dizimi denetimi
```

### İndirme hatları

1. **helper**: Service worker, native messaging ile `ythelper.exe`'yi başlatır; yardımcı
   `yt-dlp.exe`'yi çalıştırır ve ilerleme/hız/bitti olaylarını iletir. Dosya, kullanıcının
   seçtiği klasöre (varsayılan: **İndirilenler**) iner; FFmpeg kuruluysa görüntü+ses birleştirilir.
2. **frontend**: İçerik betiği sayfa bağlamında `fetch(credentials:'include')` →
   `Blob` → aynı origin `blob:` URL + `<a download>` tıklaması (TikTok'un tarayıcı içi satırları).
3. **native**: `chrome.downloads.download(url)` — X (Twitter) ve doğrudan URL'li akışlar.
   İlerleme/hız `chrome.downloads` olaylarından gelir.

### Yardımcı protokolü (özet)

`service worker → ythelper.exe` (JSON dizesi, `4 bayt uzunluk + UTF-8` çerçevesi):

```
hello|id                                  durum (yt-dlp/ffmpeg/varsayılan klasör)
ver|id                                    yt-dlp sürümü
dl|id|<seçici>|<url>|<ad>|<klasör>|<çerez> indirme başlat (alanlar base64)
cancel|id                                 iptal (süreç ağacı sonlandırılır)
reveal|id|<yol>                           klasörde göster
pickdir|id|<başlangıç klasörü>            klasör seçme penceresi
quit                                      çık
```

`ythelper.exe → service worker`: `hello`, `ver`, `start`, `p`, `done`, `err`, `canceled`,
`reveal`, `dir`. Bağlantı kapanınca yardımcı, çalışan tüm `yt-dlp` süreçlerini sonlandırıp çıkar;
kuyruk öğesi bir sonraki açılışta kaldığı yerden sürdürülür (yt-dlp `.part` devamı).

### Kuyruk durumları

```
queued → starting → downloading → complete   (helper; iptal + .part ile devam)
queued → fetching  → complete                (frontend; TikTok tarayıcı satırları)
queued → downloading → complete              (native; X)
```
Hata durumunda native indirmelerde tek otomatik yeniden deneme.

## Sorun giderme

- **`FoxDownloader-Kur.exe` / `Kaldir.exe` açılırken SmartScreen uyarısı** → Normaldir (EXE'ler
  imzasız): **Daha fazla bilgi → Yine de çalıştır**. Kodu bu depoda; dilerseniz kendiniz derleyin:
  `node devtools/build-installer.mjs`.
- **"Kurulum gerekli" ekranı görüyorum** → Ayarlar → kurulum dosyalarını indirip `.cmd`'yi
  çalıştırın; sonra tarayıcıyı yeniden başlatıp **Kontrol et**.
- **"Yardımcı kurulu değil" yazıyor ama kurdum** → Tarayıcıyı yeniden başlatın; native messaging
  kaydı açılışta okunur. Ardından Ayarlar → **Kontrol et**.
- **İndirilen dosya MP4 değil WebM/MKV** → 1440p ve 4K'da YouTube H.264 sunmaz; MP4 (AV1) veya
  WebM/MKV inebilir. **1080p ve altında her zaman MP4 (H.264 + AAC)** tercih edilir.
- **"Requested format is not available" hatası** → FFmpeg kurulu değil. Kurulumu yeniden çalıştırıp
  FFmpeg sorusuna Enter deyin (sistemde kurulu FFmpeg varsa otomatik kullanılır).
- **Dosya yanlış klasöre indi** → Ayarlar → **İndirme klasörü**: boş = İndirilenler; "Gözat…" ile
  değiştirin. Tarayıcı üzerinden yapılan indirmeler (X) her zaman tarayıcının İndirilenler
  klasörüne gider (Chrome sınırı).
- **TikTok indirilemiyor** → Listenin en üstündeki **yardımcı** satırını kullanın; alttaki tarayıcı
  satırları TikTok CDN korumasından etkilenebilir.
- **İlk yardımcı indirmesi yavaş başlıyor** → İlk `yt-dlp.exe` çalıştırmasında antivirüs taraması
  30–60 sn sürebilir; sonraki indirmeler hızlıdır.
- **Antivirüs `ythelper.exe`'yi işaretledi** → Yanlış pozitif; klasörü dışlamalara ekleyebilirsiniz
  (`%LOCALAPPDATA%\FoxDownloaderHelper`).
- **İndirme "Sayfada indiriliyor"da kaldı** → İndirmeyi başlatan sekme kapanmış olabilir;
  videoyu yeniden açıp kuyruktan **Tekrar** deyin.

## Sınırlar / yol haritası

- YouTube'un tarayıcı tarafı yüksek kaliteleri SABR/PO-token ile korur; bu yüzden indirmeler
  yardımcıya devredilir (SABR'ı eklenti içinde çözmek sürekli kırılgan olurdu).
- Yardımcıda duraklat/devam yoktur (iptal + `.part` üzerinden yeniden deneme vardır).
- Yardımcı şu an **Windows** içindir; macOS/Linux için ayrı host gerekir.
- Playlist toplu indirme, altyazı ve kapak indirme sonraki sürümlerde düşünülebilir.

## Geliştirme ve derleme

```bash
node devtools/make-extension-key.mjs   # kimliği gösterir (yoksa üretir; depoda zaten var)
node devtools/build-helper.mjs         # helper/src → helper/*.cmd|.ps1 üretir
node devtools/build-installer.mjs      # eklenti + betikleri gömer → dist/ EXE'lerini derler
node devtools/check.mjs                # tüm JS dosyalarının söz dizimini denetler
powershell -File icons/generate-icons.ps1   # tilki logosunu yeniden üretir
```

`build-installer.mjs` çıktısı:
`dist/FoxDownloader-Kur.exe` (kurulum) ve `dist/FoxDownloader-Kaldir.exe` (kaldırma).
İkisi de `/sessiz` bayrağıyla arayüzsüz çalışır (test/otomasyon için).
`dist/` depoya girmez; EXE'ler her sürümde [GitHub Releases](https://github.com/EfeKesgin/FoxDownloader/releases)
sayfasına eklenir.

> **Özel anahtar:** Paketlenmemiş eklenti için yalnızca `extension-id.json` içindeki açık
> anahtar gerekir. `make-extension-key.mjs --force` ile üretilen özel anahtar
> `devtools/extension-key.private.json` dosyasına yazılır ve **asla commit edilmez**.

### Geliştirici kurulumu (kaynaktan)

1. Bu depoyu indirin (**Code → Download ZIP**) ve bir klasöre çıkarın.
2. `brave://extensions` → **Geliştirici modu** → **Paketlenmemiş öğe yükle** → klasörü seçin.
   `manifest.json` içindeki sabit `key` sayesinde **herkeste aynı eklenti kimliği** oluşur;
   yardımcı izin listesi buna göre üretilir.
3. Ayarlar sayfası kendiliğinden açılır → **Kurulum dosyalarını indir** → inen
   `FoxDownloader-Yardimci-Kur.cmd`'ye çift tıklayın (`.ps1` aynı klasörde olmalı).
4. Tarayıcıyı yeniden başlatın → Ayarlar → **Kontrol et** → "✓ Yardımcı kurulu" yazmalı.

## Yasal not

Bu aracı yalnızca indirme hakkına sahip olduğunuz içerikler için kullanın.
Platformların kullanım koşullarına ve telif hakkı yasalarına uymak kullanıcının sorumluluğundadır.
