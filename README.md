<div align="center">

<img src="icons/icon128.png" width="96" alt="FoxDownloader">

# FoxDownloader

**YouTube, X (Twitter), TikTok ve Instagram gibi yüzlerce siteden videoyu tek tıkla, istediğin kalitede indiren tarayıcı eklentisi.**
Ücretsiz ve açık kaynak; hesap, reklam veya filigran yok. Brave, Chrome, Edge, Opera ve diğer Chromium tarayıcılarda çalışır.

[![Son sürüm](https://img.shields.io/github/v/release/EfeKesgin/FoxDownloader?label=s%C3%BCr%C3%BCm)](https://github.com/EfeKesgin/FoxDownloader/releases/latest)
[![Lisans: MIT](https://img.shields.io/badge/lisans-MIT-blue)](LICENSE)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6)
![Chromium 114+](https://img.shields.io/badge/Chromium-114%2B-4285F4)

### [⬇ Windows için indir](https://github.com/EfeKesgin/FoxDownloader/releases/latest)

<sub>Sürüm sayfasındaki <code>FoxDownloader-Kur.exe</code> dosyasını indirip çalıştır. Kurulum yaklaşık 2 dakika sürer ve yönetici izni istemez.</sub>

</div>

## Neler yapabilir?

| | |
| --- | --- |
| **YouTube** | 360p'den **4K (2160p)**'ye kadar video, M4A ve **MP3** ses. 1080p'ye kadar her yerde açılan MP4 (H.264 + AAC). |
| **1080p yüksek kalite** | YouTube'un 1080p'si çok sıkıştırılmıştır. Bu seçenek videoyu 4K kaynaktan indirip bilgisayarında keskin bir 1080p MP4'e dönüştürür (ekran kartı varsa onu kullanır). |
| **Oynatma listeleri** | YouTube listesinin tamamını 1080p, 720p ya da MP3 olarak, liste adıyla açılan bir klasöre sırayla indirir. |
| **TikTok** | **Filigransız** MP4 video ve MP3 ses. |
| **X (Twitter)** | 480p'den 720p ve üzerine kadar tüm kalite seçenekleri; giriş yapman gerekmez. |
| **Diğer siteler** | Instagram, Reddit, Vimeo, Twitch ve `yt-dlp`'nin tanıdığı yüzlerce sitede "yt-dlp ile dene" satırları. |
| **Altyazı ve kapak** | İstersen Türkçe/İngilizce altyazıyı, kapak resmini ve video bilgilerini dosyanın içine gömer. |
| **Kalite seçimi** | İndirmeden önce çözünürlüğü ve biçimi sen seçersin. |
| **İndirme kuyruğu** | Aynı anda 1–5 indirme; ilerleme yüzdesi, hız, iptal ve tekrar dene. |
| **Düzenli dosyalar** | `Yazar - Başlık [kalite].mp4` adıyla doğrudan İndirilenler'e iner, alt klasör açılmaz ve "nereye kaydedilsin" diye sormaz. İstersen klasörü Ayarlar'dan değiştirebilirsin. |
| **Kendini güncel tutar** | YouTube değiştikçe bozulmasın diye `yt-dlp` haftada bir ve bir indirme hata verdiğinde kendiliğinden güncellenir. |
| **Klasörde göster** | Biten indirmeyi tek tıkla dosya gezgininde açar. |
| **Hafif** | Boştayken hiç RAM kullanmaz. Yardımcı program yalnızca indirme sırasında açılır. |

## Kurulum

1. [Son sürüm sayfasından](https://github.com/EfeKesgin/FoxDownloader/releases/latest) **`FoxDownloader-Kur.exe`**'yi indir ve çalıştır, ardından **Kurulumu Başlat**'a tıkla.
2. Bitince tarayıcının **Uzantılar** sayfası açılır. Ekrandaki 3 adımı izle:
   **Geliştirici modu** → **Paketlenmemiş öğe yükle** → klasörü seç *(klasör yolu otomatik kopyalanır)*.
3. Video sayfasında araç çubuğundaki 🦊 simgesine tıkla, kaliteyi seç ve indir.
   *(Simge görünmüyorsa: adres çubuğunun yanındaki 🧩 → FoxDownloader → Sabitle.)*

> Kurulum internet ister: yt-dlp (~18 MB), Deno (~43 MB) ve sistemde yoksa FFmpeg (~90 MB) otomatik
> indirilir ve SHA-256 özetleriyle doğrulanır.

**Güncellemek için:** Yeni sürümün `FoxDownloader-Kur.exe`'sini çalıştır, ardından tarayıcıda Uzantılar →
FoxDownloader'ın yenile düğmesine bas. Tarayıcıya yeniden eklemen gerekmez.

**Kaldırmak için:** `FoxDownloader-Kaldir.exe` → Kaldır. Ardından tarayıcıda Uzantılar → FoxDownloader → **Kaldır**.

## Neden güvenilir?

- **Açık kaynak:** Eklentinin, yardımcı programın ve kurulum dosyasının kodlarının tamamı bu
  sayfada. EXE'ler de bu kaynaklardan derlenir.
- **Yönetici izni gerekmez:** Sistem klasörlerine hiçbir şey kurulmaz. Her şey
  `%LOCALAPPDATA%\FoxDownloaderHelper` altında durur ve kaldırınca silinir.
- **Verilerin sende kalır:** İndirmeler doğrudan bilgisayarında yapılır. İnternetten
  indirilen dış dosyalar yalnızca açık kaynak `yt-dlp`, Deno ve gerekirse FFmpeg'dir; hepsi
  yayınlandıkları projenin SHA-256 özetiyle doğrulanır.
- **Hesap ve kişisel veri yok:** Eklenti hiçbir hesaba bağlanmaz, kişisel veri toplamaz.

### Windows "tanınmayan uygulama" uyarısı

FoxDownloader ücretsiz bir proje olduğu için EXE dosyaları ücretli bir kod imzalama
sertifikasıyla imzalanmamıştır. Bu yüzden Windows SmartScreen bir uyarı gösterebilir:
**Ek bilgi → Yine de çalıştır**'a tıklayarak devam edebilirsin. Dosyaları yalnızca bu sayfadaki
[Sürümler](https://github.com/EfeKesgin/FoxDownloader/releases) bölümünden indir. Aynı sebeple bazı
antivirüsler yardımcı programı yanlışlıkla işaretleyebilir. Bu durumda
`%LOCALAPPDATA%\FoxDownloaderHelper` klasörünü dışlamalara ekleyebilirsin.

## Sık sorulanlar

<details>
<summary><b>Neden ayrıca bir "yardımcı" kuruluyor?</b></summary>

YouTube 1080p ve üzeri kaliteleri tarayıcı eklentilerine kapatıyor, TikTok da doğrudan
indirmeyi engelliyor. FoxDownloader bu yüzden indirmeleri bilgisayarındaki açık kaynak `yt-dlp`
üzerinden yapar. Yardımcı boştayken çalışmaz, yalnızca indirme sırasında açılır.
</details>

<details>
<summary><b>"Kurulum gerekli" ekranı görüyorum.</b></summary>

Tarayıcıyı tamamen kapatıp yeniden aç, ardından Ayarlar → **Kontrol et**'e tıkla.
</details>

<details>
<summary><b>Kalite seçenekleri gelmedi veya indirme başlamıyor.</b></summary>

Sayfayı yenileyip tekrar dene. Sorun sürerse Ayarlar → **Kontrol et**.
</details>

<details>
<summary><b>YouTube 1080p bulanık görünüyor.</b></summary>

YouTube'un 1080p akışı yaklaşık 2,5 Mbps'ye sıkıştırılmıştır. **1080p • Yüksek kalite** satırını
seç: video 4K kaynaktan indirilip bilgisayarında 1080p'ye dönüştürülür. Ekran kartıyla genelde
1 dakikadan kısa sürer.
</details>

<details>
<summary><b>YouTube indirmesi birden hata vermeye başladı.</b></summary>

YouTube değişmiş olabilir. Ayarlar → **Şimdi güncelle** ile `yt-dlp`'yi güncelle (otomatik
güncelleme açıksa bu zaten kendiliğinden denenir). Ayarlar'da "Deno: Yok" ya da "kurulum eski"
görüyorsan `FoxDownloader-Kur.exe`'yi yeniden çalıştır.
</details>

<details>
<summary><b>İnen dosya MP4 değil, WebM/MKV.</b></summary>

YouTube 1440p ve 4K'da H.264 sunmuyor, bu kalitelerde MP4 (AV1) ya da WebM/MKV iner.
1080p ve altında her zaman MP4 (H.264 + AAC) seçilir.
</details>

<details>
<summary><b>İlk indirme yavaş başladı.</b></summary>

`yt-dlp` ilk kez çalışırken antivirüs taraması 30–60 saniye sürebilir. Sonraki indirmeler hızlıdır.
</details>

Tam sorun giderme listesi için [TEKNIK.md → Sorun giderme](TEKNIK.md#sorun-giderme) bölümüne bak.

## English

**FoxDownloader** is a free, open-source browser extension for Chromium-based browsers
(Brave, Chrome, Edge, Opera) on Windows. It downloads YouTube videos up to 4K (plus whole playlists and
MP3), watermark-free TikTok videos, X (Twitter) videos and anything else `yt-dlp` supports, with
quality selection, a download queue, progress and speed tracking. High-quality downloads go through a small local helper that uses the open-source
`yt-dlp`; it needs no admin rights and only runs while downloading. The interface is in Turkish.
[Download for Windows](https://github.com/EfeKesgin/FoxDownloader/releases/latest).

---

## Geliştiriciler için

Aşağıdaki bölümler projeyi kaynaktan çalıştırmak, derlemek ve katkıda bulunmak içindir.
Mimari, indirme hatları ve yardımcı protokolünün ayrıntıları **[TEKNIK.md](TEKNIK.md)**'de.

### Gereksinimler

- Windows 10/11
- Node.js 20 veya üzeri (derleme betikleri için)
- .NET Framework 4.x C# derleyicisi (`csc.exe`, Windows ile birlikte gelir; EXE'leri derlemek için)

### Derleme

```powershell
git clone https://github.com/EfeKesgin/FoxDownloader.git
cd FoxDownloader
node devtools/check.mjs            # tüm JS dosyalarında söz dizimi denetimi
node devtools/build-helper.mjs     # helper/src → helper/*.cmd | .ps1
node devtools/build-installer.mjs  # dist/FoxDownloader-Kur.exe ve Kaldir.exe
npm test                           # birim testleri + yardımcı entegrasyon testi
```

Eklentiyi kaynaktan denemek için Uzantılar sayfasında **Paketlenmemiş öğe yükle** ile proje
klasörünü seç, ardından Ayarlar sayfasından yardımcıyı kur.

### Proje yapısı

```
src/         Eklenti: service worker, içerik betikleri, popup ve ayarlar sayfası
helper/      Yerel yardımcı (C# native messaging host) ve kurulum betikleri
installer/   Kurulum / kaldırma EXE arayüzleri (C#)
devtools/    Derleme ve denetim betikleri, sabit eklenti kimliği
icons/       Eklenti ikonları
```

### Sürüm yayınlama

1. `manifest.json` ve `package.json` içindeki `version` değerini artır, `main`'e birleştir.
2. `node devtools/build-installer.mjs` ile EXE'leri derle.
3. `gh release create v1.2.3 dist/*.exe` ile sürümü oluşturup iki EXE'yi ekle. `dist/` klasörü depoya eklenmez.

## Yasal not

Bu aracı yalnızca indirme hakkına sahip olduğun içerikler için kullan. Platformların kullanım
koşullarına ve telif hakkı yasalarına uymak kullanıcının sorumluluğundadır.

## Lisans

FoxDownloader [MIT Lisansı](LICENSE) ile dağıtılır. Yardımcı programın kullandığı
[yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), [Deno](https://deno.com/) (MIT) ve [FFmpeg](https://ffmpeg.org/) (LGPL/GPL)
kendi lisanslarıyla kurulum sırasında ayrıca indirilir.
