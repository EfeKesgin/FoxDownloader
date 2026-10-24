# FoxDownloader 🦊

YouTube (4K'ya kadar, oynatma listeleri dahil), X (Twitter), TikTok ve yt-dlp'nin tanıdığı
diğer sitelerden (Instagram, Reddit, Vimeo, Twitch…) video ve MP3 indirmenizi sağlayan tarayıcı
eklentisi. Brave, Chrome, Edge, Opera ve diğer Chromium tabanlı tarayıcılarda çalışır (Windows).

Ücretsiz ve açık kaynak — [MIT Lisansı](LICENSE).

---

## Kurulum (2 dakika)

1. [**Son sürümü indirin**](https://github.com/EfeKesgin/FoxDownloader/releases/latest)
   → **`FoxDownloader-Kur.exe`**
2. Çalıştırın → **Kurulumu Başlat**.
   *SmartScreen uyarısı çıkarsa:* **Daha fazla bilgi → Yine de çalıştır**
   *(dosyalar imzasızdır; tüm kaynak kodu bu depoda)*
3. Bitince tarayıcı **Uzantılar** sayfasında açılır — ekrandaki 3 adımı izleyin:
   **Geliştirici modu** → **Paketlenmemiş öğe yükle** → klasörü seç
   *(klasör yolu otomatik kopyalanır)*

Hazır! Video sayfasında araç çubuğundaki 🦊 simgesine tıklayın, kaliteyi seçip indirin.
*(Simge görünmüyorsa: adres çubuğunun yanındaki 🧩 simgesi → FoxDownloader → Sabitle.)*

> - **Yönetici izni gerekmez**; sistem klasörlerine hiçbir şey kurulmaz.
> - Kurulum internet ister: yardımcı araçlar otomatik indirilir ve SHA-256 ile doğrulanır
>   (yt-dlp ~18 MB, Deno ~43 MB; FFmpeg sistemde yoksa ~90 MB).
> - **Güncelleme:** yeni sürümün `FoxDownloader-Kur.exe`'sini çalıştırıp tarayıcıda eklentiyi
>   yenilemeniz yeterli. yt-dlp ise kendiliğinden (haftada bir) güncellenir.

## Kaldırma

**`FoxDownloader-Kaldir.exe`** → Kaldır.
Ardından tarayıcıdan: Uzantılar sayfası → FoxDownloader → **Kaldır**.

## Sık sorulanlar

- **İndirilenler nereye gidiyor?** İndirilenler klasörüne — alt klasör açılmaz.
  Dilerseniz Ayarlar'dan başka bir klasör seçebilirsiniz.
- **"Kurulum gerekli" ekranı görüyorum.** Tarayıcıyı yeniden başlatın → Ayarlar → **Kontrol et**.
- **Kalite seçenekleri gelmedi / indirme başlamıyor.** Sayfayı yenileyip tekrar deneyin;
  sürerse Ayarlar → **Kontrol et**.
- **Antivirüs yardımcıyı işaretledi.** Yanlış pozitiftir (yerel derlenen imzasız bir araçtır);
  isterseniz `%LOCALAPPDATA%\FoxDownloaderHelper` klasörünü dışlamalara ekleyin.
- **Hangi kaliteler destekleniyor?** YouTube 360p–4K ve MP3, TikTok filigransız MP4 ve MP3, X 720p+.
- **YouTube 1080p bulanık görünüyor.** YouTube'un 1080p akışı çok sıkıştırılmıştır.
  **1080p • Yüksek kalite** satırını seçin: video 4K kaynaktan indirilip bilgisayarınızda 1080p'ye
  küçültülür (ekran kartıyla genelde 1 dakikadan kısa sürer).
- **Oynatma listesinin tamamını indirebilir miyim?** Evet: liste içindeki bir videoda ya da liste
  sayfasında popup'ta **Oynatma listesinin tamamı** bölümü çıkar; videolar liste adıyla açılan
  klasöre sırayla iner.
- **Başka siteler?** Desteklenmeyen bir sitedeyken popup "yt-dlp ile dene" satırları gösterir;
  site yt-dlp tarafından tanınıyorsa indirilir.
- **YouTube indirmesi birden hata vermeye başladı.** YouTube değişmiş olabilir: Ayarlar →
  **Şimdi güncelle** (otomatik güncelleme açıksa bu zaten kendiliğinden denenir).
- **Neden ekstra bir "yardımcı" kuruluyor?** YouTube yüksek kaliteleri tarayıcıya kapatıyor;
  indirmeyi yerel, açık kaynak `yt-dlp` üzerinden yapıyoruz.

## Teknik

Mimari, indirme hatları, yardımcı protokolü, tam sorun giderme listesi ve geliştirme:
→ **[TEKNIK.md](TEKNIK.md)**

Yardımcı boşta çalışmaz (0 MB); yalnızca indirme sırasında açılır.

## Yasal not

Bu aracı yalnızca indirme hakkına sahip olduğunuz içerikler için kullanın.
Platformların kullanım koşullarına ve telif hakkı yasalarına uymak kullanıcının sorumluluğundadır.
