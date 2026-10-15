# ============================================================================
# FoxDownloader - Yardimci KALDIRMA
#
# FoxDownloader-Yardimci-Kaldir.cmd tarafindan calistirilir.
# Kayit defteri anahtarlarini ve %LOCALAPPDATA%\FoxDownloaderHelper klasorunu
# (ythelper.exe, yt-dlp.exe, FFmpeg, manifest) siler.
# ============================================================================

$ErrorActionPreference = 'Stop'

# Cikti kodlamasi: arayuz (EXE) ve konsol Turkce karakterleri dogru okusun.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$hostName  = 'com.foxdownloader.ythelper'
$helperDir = Join-Path $env:LOCALAPPDATA 'FoxDownloaderHelper'
$argsText  = [string]$env:VDH_ARGS
$silent    = $argsText -match '(?i)sessiz|-s\b'

function Line($msg, $color) {
    if ($color) { Write-Host $msg -ForegroundColor $color } else { Write-Host $msg }
}

Line ''
Line '========================================================' 'DarkCyan'
Line '  FoxDownloader  -  Yardimci Kaldirma' 'DarkCyan'
Line '========================================================' 'DarkCyan'
Line ''

if (-not $silent) {
    $answer = Read-Host 'Yardimci kaldirilsin mi? [e/H]'
    if ($answer -notmatch '^(?i)\s*e') {
        Line '  Islem iptal edildi.' 'Yellow'
        Line ''
        Read-Host 'Kapatmak icin Enter tusuna basin' | Out-Null
        exit 0
    }
}

$browserBases = @(
    'HKCU:\Software\Google\Chrome',
    'HKCU:\Software\Chromium',
    'HKCU:\Software\BraveSoftware\Brave-Browser',
    'HKCU:\Software\Microsoft\Edge',
    'HKCU:\Software\Vivaldi',
    'HKCU:\Software\Opera Software'
)
$removeHosts = @($hostName, 'com.videodownloader.ythelper')
$removeDirs = @($helperDir, (Join-Path $env:LOCALAPPDATA 'VideoDownloaderHelper'))
$removed = 0
foreach ($base in $browserBases) {
    foreach ($h in $removeHosts) {
        $key = $base + '\NativeMessagingHosts\' + $h
        try {
            if (Test-Path $key) {
                Remove-Item -Path $key -Recurse -Force
                $removed++
            }
        } catch {
            Line ('   [!] Kayit anahtari silinemedi: ' + $key) 'Yellow'
        }
    }
}
Line ('   [OK] Kayit defteri anahtarlari silindi (' + $removed + ')') 'Green'

foreach ($d in $removeDirs) {
    if (Test-Path $d) {
        try {
            Remove-Item -Path $d -Recurse -Force
            Line ('   [OK] Klasor silindi: ' + $d) 'Green'
        } catch {
            Line ('   [!] Klasor silinemedi: ' + $_.Exception.Message) 'Yellow'
        }
    }
}
if (-not (Test-Path $helperDir)) { Line '   [i]  Yardimci klasoru zaten yok' 'Gray' }

Line ''
Line '  Kaldirma tamamlandi. Tarayiciyi yeniden baslatin.' 'Green'
Line ''
if (-not $silent) { Read-Host 'Kapatmak icin Enter tusuna basin' | Out-Null }
