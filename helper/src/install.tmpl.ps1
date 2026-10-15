# ============================================================================
# FoxDownloader - Yardimci KURULUM
#
# Bu betik (FoxDownloader-Yardimci-Kur.cmd ile birlikte calistirilir):
#   1) ythelper.exe  : yerel C# derleyicisiyle derlenir (native messaging host)
#   2) yt-dlp.exe    : GitHub'dan indirilir (~18 MB)
#   3) FFmpeg        : istege bagli indirilir (1080p+ icin birlestirme)
#   4) Native messaging manifestosu + kayit defteri anahtarlari yazilir
#
# Kaldirma: FoxDownloader-Yardimci-Kaldir.cmd
# Sessiz:   FoxDownloader-Yardimci-Kur.cmd -Sessiz
# ============================================================================

$ErrorActionPreference = 'Stop'

# Cikti kodlamasi: arayuz (EXE) ve konsol Turkce karakterleri dogru okusun.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$extensionId = '__EXTENSION_ID__'
$hostName    = 'com.foxdownloader.ythelper'
$helperDir   = Join-Path $env:LOCALAPPDATA 'FoxDownloaderHelper'

$argsText    = [string]$env:VDH_ARGS
$silent      = $argsText -match '(?i)sessiz|-s\b'
$forceFfmpeg = $argsText -match '(?i)^.*?\bffmpeg\b'
$skipFfmpeg  = $argsText -match '(?i)noffmpeg'

function Line($msg, $color) {
    if ($color) { Write-Host $msg -ForegroundColor $color } else { Write-Host $msg }
}
function Step($msg) { Write-Host ''; Line ('== ' + $msg) 'Cyan' }
function Good($msg) { Line ('   [OK] ' + $msg) 'Green' }
function Note($msg) { Line ('   [i]  ' + $msg) 'Gray' }
function Warn2($msg) { Line ('   [!]  ' + $msg) 'Yellow' }
function Fail($msg) {
    Line ('   [HATA] ' + $msg) 'Red'
    if (-not $silent) { Read-Host 'Kapatmak icin Enter tusuna basin' | Out-Null }
    exit 1
}

# UTF-8 metni istenen kodlamayla yazar
function Write-Text($path, $text, $withBom) {
    $enc = New-Object System.Text.UTF8Encoding($withBom)
    [IO.File]::WriteAllText($path, $text, $enc)
}

# Ilereleme cubuguyla indirir (HttpClient; buyuk dosyalarda guvenilir)
function Get-File($url, $out) {
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch { }
    Add-Type -AssemblyName System.Net.Http | Out-Null
    $handler = New-Object System.Net.Http.HttpClientHandler
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(60)
    $part = $out + '.part'
    try {
        $resp = $client.GetAsync($url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if (-not $resp.IsSuccessStatusCode) { throw ('HTTP ' + [int]$resp.StatusCode) }
        $total = 0
        if ($resp.Content.Headers.ContentLength) { $total = [long]$resp.Content.Headers.ContentLength }
        $stream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $file = [IO.File]::Create($part)
        try {
            $buf = New-Object byte[] 262144
            $done = 0
            $last = Get-Date
            while ($true) {
                $read = $stream.Read($buf, 0, $buf.Length)
                if ($read -le 0) { break }
                $file.Write($buf, 0, $read)
                $done += $read
                if (((Get-Date) - $last).TotalMilliseconds -gt 250) {
                    $last = Get-Date
                    if ($total -gt 0) {
                        $pct = [int](100 * $done / $total)
                        Write-Progress -Activity 'Indiriliyor' -Status ('{0:N1} MB / {1:N1} MB' -f ($done / 1MB), ($total / 1MB)) -PercentComplete $pct
                    } else {
                        Write-Progress -Activity 'Indiriliyor' -Status ('{0:N1} MB' -f ($done / 1MB))
                    }
                }
            }
        } finally {
            $file.Close()
            $stream.Close()
        }
    } finally {
        Write-Progress -Activity 'Indiriliyor' -Completed
        $client.Dispose()
    }
    Move-Item -Force $part $out
}

Line ''
Line '========================================================' 'DarkCyan'
Line '  FoxDownloader  -  Yardimci Kurulumu' 'DarkCyan'
Line '========================================================' 'DarkCyan'
Line ''
Line ('  Yardimci klasoru : ' + $helperDir) 'White'
Line ('  Eklenti kimligi  : ' + $extensionId) 'White'
if ($silent) { Line '  Mod             : sessiz' 'DarkGray' }

try {
    New-Item -ItemType Directory -Force -Path $helperDir | Out-Null
} catch {
    Fail ('Klasor olusturulamadi: ' + $helperDir)
}

# ---------------------------------------------------------------------------
Step '1/6  ythelper.exe derleniyor (yerel C# derleyicisi)'
# ---------------------------------------------------------------------------
$csPath  = Join-Path $helperDir 'ythelper.cs'
$exePath = Join-Path $helperDir 'ythelper.exe'
$csSource = @'
__CS_SOURCE__
'@

Write-Text $csPath $csSource $true

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v2.0.50727\csc.exe' }
if (-not (Test-Path $csc)) { Fail '.NET derleyicisi (csc.exe) bulunamadi. Windows surumu cok eski olabilir.' }

if (Test-Path $exePath) { Remove-Item -Force $exePath -ErrorAction SilentlyContinue }
$cscOut = & $csc /nologo /optimize+ /target:exe ('/out:' + $exePath) '/r:System.Windows.Forms.dll' '/r:System.Drawing.dll' $csPath 2>&1
if (-not (Test-Path $exePath)) {
    Line ($cscOut | Out-String) 'DarkGray'
    Fail 'C# derlemesi basarisiz oldu.'
}
Good ('ythelper.exe hazir (' + [math]::Round((Get-Item $exePath).Length / 1KB) + ' KB)')

# ---------------------------------------------------------------------------
Step '2/6  yt-dlp indiriliyor'
# ---------------------------------------------------------------------------
$ytdlp = Join-Path $helperDir 'yt-dlp.exe'
$needYtdlp = $true
if ((Test-Path $ytdlp) -and ((Get-Item $ytdlp).Length -gt 5MB)) {
    $ageDays = ((Get-Date) - (Get-Item $ytdlp).LastWriteTime).TotalDays
    if ($ageDays -lt 30) {
        $needYtdlp = $false
        Good ('yt-dlp.exe zaten kurulu (' + [int]$ageDays + ' gun once indirildi, indirme atlandi)')
    } else {
        Note ('yt-dlp.exe eski (' + [int]$ageDays + ' gun) - guncelleniyor')
    }
}
if ($needYtdlp) {
    try {
        Get-File 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' $ytdlp
    } catch {
        Fail ('yt-dlp indirilemedi: ' + $_.Exception.Message + '  (Internet baglantinizi kontrol edin)')
    }
    Good ('yt-dlp.exe indirildi (' + [math]::Round((Get-Item $ytdlp).Length / 1MB, 1) + ' MB)')
}

$verOut = Join-Path $env:TEMP ('vd-ver-' + [guid]::NewGuid().ToString('N') + '.txt')
try {
    Note 'yt-dlp ilk calistirma biraz uzun surebilir (antivirus taramasi)...'
    $proc = Start-Process -FilePath $ytdlp -ArgumentList '--version' -NoNewWindow -PassThru -RedirectStandardOutput $verOut
    if (-not $proc.WaitForExit(120000)) { try { $proc.Kill() } catch { } }
    $ver = ''
    if (Test-Path $verOut) { $ver = ([IO.File]::ReadAllText($verOut)).Trim() }
    if ($ver.Length -gt 0) {
        Write-Text (Join-Path $helperDir 'version.txt') $ver $false
        Good ('yt-dlp surumu: ' + $ver)
    } else {
        Warn2 'yt-dlp surumu okunamadi (sorun degil)'
    }
} catch {
    Warn2 ('yt-dlp surumu okunamadi: ' + $_.Exception.Message)
} finally {
    Remove-Item -Force $verOut -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
Step '3/6  FFmpeg kontrolu (1080p+ icin goruntu+ses birlestirme)'
# ---------------------------------------------------------------------------
$ffLocal = Join-Path $helperDir 'ffmpeg.exe'
$ffPath = $null
if (Test-Path $ffLocal) {
    $ffPath = $ffLocal
    Good 'FFmpeg yardimci klasorunde bulundu'
} else {
    $ffCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($ffCmd) {
        $ffPath = $ffCmd.Source
        Good ('FFmpeg sistemde bulundu: ' + $ffPath)
    }
}

if (-not $ffPath) {
    $want = $true
    if ((-not $silent) -and (-not $forceFfmpeg) -and (-not $skipFfmpeg)) {
        Line '   FFmpeg, goruntu ve sesi birlestirmek icin GEREKLIDIR.' 'White'
        Line '   YouTube artik videolari tek parca sunmadigi icin FFmpeg olmadan' 'White'
        Line '   indirmeler buyuk olasilikla "format bulunamadi" hatasiyla biter.' 'White'
        Line '   FFmpeg acik kaynaklidir; ~130 MB indirilir.' 'White'
        $answer = Read-Host '   FFmpeg indirilsin mi? [E/h]'
        if ($answer -match '^(?i)\s*h') { $want = $false }
    }
    if ($want -and (-not $skipFfmpeg)) {
        $zip = Join-Path $env:TEMP 'vd-ffmpeg.zip'
        try {
            Get-File 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' $zip
            Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
            $arch = [IO.Compression.ZipFile]::OpenRead($zip)
            try {
                foreach ($entry in $arch.Entries) {
                    if ($entry.Name -eq 'ffmpeg.exe' -or $entry.Name -eq 'ffprobe.exe') {
                        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $helperDir $entry.Name), $true)
                    }
                }
            } finally {
                $arch.Dispose()
            }
            Remove-Item -Force $zip -ErrorAction SilentlyContinue
            if (Test-Path $ffLocal) {
                $ffPath = $ffLocal
                Good 'FFmpeg kuruldu'
            } else {
                Warn2 'FFmpeg arsivden cikarilamadi'
            }
        } catch {
            Warn2 ('FFmpeg indirilemedi: ' + $_.Exception.Message)
            Remove-Item -Force $zip -ErrorAction SilentlyContinue
        }
    } else {
        Warn2 'FFmpeg olmadan YouTube indirmeleri genellikle basarisiz olur.'
        Warn2 'Sonradan eklemek icin bu kurulumu yeniden calistirin (FFmpeg sorusuna Enter).'
    }
}

# ---------------------------------------------------------------------------
Step '4/6  Native messaging manifestosu yaziliyor'
# ---------------------------------------------------------------------------
$manifestPath = Join-Path $helperDir ($hostName + '.json')
$manifest = [ordered]@{
    name            = $hostName
    description     = 'FoxDownloader yardimcisi (yt-dlp)'
    path            = $exePath
    type            = 'stdio'
    allowed_origins = @('chrome-extension://' + $extensionId + '/')
}
$json = $manifest | ConvertTo-Json -Depth 4
Write-Text $manifestPath $json $false
Good $manifestPath

# ---------------------------------------------------------------------------
Step '5/6  Tarayici kayit defteri anahtarlari (HKCU, yonetici gerekmez)'
# ---------------------------------------------------------------------------
$browserBases = @(
    'HKCU:\Software\Google\Chrome',
    'HKCU:\Software\Chromium',
    'HKCU:\Software\BraveSoftware\Brave-Browser',
    'HKCU:\Software\Microsoft\Edge',
    'HKCU:\Software\Vivaldi',
    'HKCU:\Software\Opera Software'
)
$written = 0
foreach ($base in $browserBases) {
    $key = $base + '\NativeMessagingHosts\' + $hostName
    try {
        New-Item -Path $key -Force | Out-Null
        Set-ItemProperty -Path $key -Name '(Default)' -Value $manifestPath -Type String
        $written++
    } catch {
        Warn2 ('Kayit anahtari yazilamadi: ' + $key + ' -> ' + $_.Exception.Message)
    }
}
Good ($written.ToString() + ' tarayici icin kaydedildi (Chrome, Chromium, Brave, Edge, Vivaldi, Opera)')

# Eski surum kalintilari (eski host adi + eski klasor) varsa temizle.
$oldHostName = 'com.videodownloader.ythelper'
$oldDir = Join-Path $env:LOCALAPPDATA 'VideoDownloaderHelper'
$oldCleaned = 0
foreach ($base in $browserBases) {
    $oldKey = $base + '\NativeMessagingHosts\' + $oldHostName
    try {
        if (Test-Path $oldKey) {
            Remove-Item -Path $oldKey -Recurse -Force
            $oldCleaned++
        }
    } catch { }
}
if (Test-Path $oldDir) {
    try {
        Remove-Item -Path $oldDir -Recurse -Force
        $oldCleaned++
    } catch { }
}
if ($oldCleaned -gt 0) { Note ('Eski surum kalintilari temizlendi (' + $oldCleaned + ')') }

# ---------------------------------------------------------------------------
Step '6/6  Ozet'
# ---------------------------------------------------------------------------
Line ''
Line '  Kurulum tamamlandi.' 'Green'
Line ''
Line '  Sirada:' 'White'
Line '   1) Tarayicida eklentinin Ayarlar sayfasini acin' 'White'
Line '   2) "Kontrol et" dugmesine basin -> "Yardimci kurulu" yazmali' 'White'
Line '   3) Bir YouTube videosunda popup/panelden 1080p secin' 'White'
Line ''
Line '  Not: Yardimci yalnizca indirme sirasinda calisir; bos dururken' 'DarkGray'
Line '       hicbir surec acik kalmaz (0 MB bellek).' 'DarkGray'
Line ''
Line ('  Kaldirma icin: ' + 'FoxDownloader-Yardimci-Kaldir.cmd') 'DarkGray'
Line ''
if (-not $silent) { Read-Host 'Kapatmak icin Enter tusuna basin' | Out-Null }
