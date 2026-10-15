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

$extensionId = 'fcijbffelnnaoeginnhphhhlfhadpbof'
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
// ythelper.exe — FoxDownloader YouTube yardımcısı (native messaging host)
//
// Chrome/Chromium native messaging protokolü: 4 bayt küçük-endian uzunluk + UTF-8 JSON.
// Bu yardımcı, tarayıcının başlattığı küçük bir süreçtir; ağır işi (indirmeyi) yt-dlp.exe
// yapar ve yalnızca indirme sırasında çalışır. Port kapandığında (tarayıcı bağlantıyı
// kestiğinde) kendiliğinden kapanır → boşta bellek kullanımı ~0.
//
// Gelen komutlar tek bir JSON dizesidir: "cmd|alan1|alan2|..."
// (metin alanları Base64'tür; böylece kaçış karakteri sorunu kalmaz)
//
//   hello|id                                → sürüm/durum bilgisi
//   ver|id                                  → yt-dlp sürümünü canlı sorgula
//   dl|id|<seçici>|<url>|<ad>|<dizin>|<çerez> → indirme başlat (base64 alanlar)
//   cancel|id                               → indirmeyi iptal et
//   reveal|id|<yol>                         → klasörde göster
//   pickdir|id|<başlangıç dizini>           → klasör seçme penceresi aç (base64)
//   quit                                    → çık
//
// Not: <dizin> boş gelirse dosya kullanıcının İndirilenler klasörüne iner;
// yardımcı kendiliğinden alt klasör OLUŞTURMAZ.
//
// Gönderilen olaylar (JSON nesnesi):
//   {"ev":"hello","id":...,"v":1,"ytdlp":1,"ffmpeg":1,"dir":"<b64>","ytdlpV":"<b64>"}
//   {"ev":"ver","id":...,"v":"<b64>"}
//   {"ev":"start","id":...} | {"ev":"err","id":...,"m":"<b64>","code":N}
//   {"ev":"p","id":...,"d":N,"t":N,"s":N,"e":N}
//   {"ev":"done","id":...,"f":"<b64>","bytes":N}
//   {"ev":"canceled","id":...}
//   {"ev":"reveal","id":...,"ok":1}
//
// Derleme:
//   csc.exe /nologo /optimize+ /target:exe /out:ythelper.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll ythelper.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Program
{
    const string PROGRESS_MARK = "@@@P:";
    const string FILE_MARK = "@@@FILE:";
    const int MAX_FRAME = 8 * 1024 * 1024;
    const int MIN_PROGRESS_MS = 250;

    static Stream stdin;
    static Stream stdout;
    static readonly object outLock = new object();
    static readonly object mapLock = new object();
    static readonly Dictionary<string, Download> active = new Dictionary<string, Download>();
    static string exeDir;
    static int shuttingDown;

    sealed class Download
    {
        public string Id;
        public string Selector;
        public string Url;
        public string Name;
        public string Dir;
        public string Cookies;
        public Process Proc;
        public int Pid;
        public long LastSentMs;
        public long LastBytes;
        public long LastSpeed;
        public long LastEta;
        public long LastTotal;
        public string LastError;
        public string FinalPath;
        public volatile bool Canceled;
    }

    static void Main()
    {
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);
        }
        catch { }
        stdin = Console.OpenStandardInput();
        stdout = Console.OpenStandardOutput();
        exeDir = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);

        try
        {
            Loop();
        }
        catch
        {
            // sessizce kapan
        }
        finally
        {
            KillAll();
        }
        Environment.Exit(0);
    }

    // ---------- native messaging çerçeveleme ----------

    static string ReadFrame()
    {
        byte[] lenBytes = new byte[4];
        if (!ReadFull(lenBytes, 4)) return null;
        int len = BitConverter.ToInt32(lenBytes, 0);
        if (len <= 0 || len > MAX_FRAME) return null;
        byte[] buf = new byte[len];
        if (!ReadFull(buf, len)) return null;
        return Encoding.UTF8.GetString(buf);
    }

    static bool ReadFull(byte[] buf, int count)
    {
        int got = 0;
        while (got < count)
        {
            int n;
            try
            {
                n = stdin.Read(buf, got, count - got);
            }
            catch
            {
                return false;
            }
            if (n <= 0) return false;
            got += n;
        }
        return true;
    }

    static void Send(string json)
    {
        if (Volatile.Read(ref shuttingDown) == 1) return;
        byte[] bytes = Encoding.UTF8.GetBytes(json);
        lock (outLock)
        {
            try
            {
                stdout.Write(BitConverter.GetBytes(bytes.Length), 0, 4);
                stdout.Write(bytes, 0, bytes.Length);
                stdout.Flush();
            }
            catch
            {
                // tarayıcı kapanmış olabilir
            }
        }
    }

    static string B64(string s)
    {
        if (s == null) s = "";
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(s));
    }

    static string UnB64(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        try
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(s));
        }
        catch
        {
            return "";
        }
    }

    static string Js(string s)
    {
        return "\"" + B64(s) + "\"";
    }

    // Kimlikler (UUID) düz metin gider: yalnızca güvenli karakterler korunur.
    static string Jid(string s)
    {
        if (string.IsNullOrEmpty(s)) return "\"\"";
        StringBuilder sb = new StringBuilder(s.Length);
        foreach (char c in s)
        {
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.') sb.Append(c);
        }
        return "\"" + sb.ToString() + "\"";
    }

    // ---------- ana döngü ----------

    static void Loop()
    {
        for (;;)
        {
            string frame = ReadFrame();
            if (frame == null) return; // stdin kapandı → tarayıcı bağlantıyı kesti
            string payload = frame.Trim();
            if (payload.Length >= 2 && payload[0] == '"' && payload[payload.Length - 1] == '"')
            {
                payload = payload.Substring(1, payload.Length - 2);
            }
            else
            {
                continue; // nesne/dizi beklenmiyor
            }
            string[] parts = payload.Split('|');
            if (parts.Length == 0) continue;
            string cmd = parts[0];
            if (cmd == "hello") CmdHello(parts);
            else if (cmd == "ver") CmdVersion(parts);
            else if (cmd == "dl") CmdDownload(parts);
            else if (cmd == "cancel") CmdCancel(parts);
            else if (cmd == "reveal") CmdReveal(parts);
            else if (cmd == "pickdir") CmdPickDir(parts);
            else if (cmd == "quit")
            {
                KillAll();
                Volatile.Write(ref shuttingDown, 1);
                return;
            }
        }
    }

    static string Arg(string[] parts, int i)
    {
        return parts.Length > i ? parts[i] : "";
    }

    // ---------- komutlar ----------

    static void CmdHello(string[] parts)
    {
        string id = Arg(parts, 1);
        string ytdlpPath = Path.Combine(exeDir, "yt-dlp.exe");
        bool hasYtdlp = File.Exists(ytdlpPath);
        string version = "";
        if (hasYtdlp)
        {
            try
            {
                string vf = Path.Combine(exeDir, "version.txt");
                if (File.Exists(vf)) version = File.ReadAllText(vf).Trim();
            }
            catch { }
        }
        Send("{\"ev\":\"hello\",\"id\":" + Jid(id) +
             ",\"v\":1,\"ytdlp\":" + (hasYtdlp ? "1" : "0") +
             ",\"ffmpeg\":" + (FindFfmpeg() != null ? "1" : "0") +
             ",\"dir\":" + Js(DefaultDir()) +
             ",\"exe\":" + Js(exeDir) +
             ",\"ytdlpV\":" + Js(version) + "}");
    }

    static void CmdVersion(string[] parts)
    {
        string id = Arg(parts, 1);
        ThreadPool.QueueUserWorkItem(delegate(object state)
        {
            string version = "";
            try
            {
                string exe = Path.Combine(exeDir, "yt-dlp.exe");
                if (File.Exists(exe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo(exe, "--version");
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    psi.RedirectStandardOutput = true;
                    psi.RedirectStandardError = true;
                    using (Process p = Process.Start(psi))
                    {
                        string stdoutText = p.StandardOutput.ReadToEnd();
                        p.StandardError.ReadToEnd();
                        if (!p.WaitForExit(20000))
                        {
                            try { p.Kill(); } catch { }
                        }
                        version = (stdoutText ?? "").Trim();
                    }
                    if (version.Length > 0)
                    {
                        try { File.WriteAllText(Path.Combine(exeDir, "version.txt"), version); } catch { }
                    }
                }
            }
            catch { }
            Send("{\"ev\":\"ver\",\"id\":" + Jid(id) + ",\"v\":" + Js(version) + "}");
        });
    }

    static void CmdDownload(string[] parts)
    {
        string id = Arg(parts, 1);
        string selector = UnB64(Arg(parts, 2));
        string url = UnB64(Arg(parts, 3));
        string name = SanitizeName(UnB64(Arg(parts, 4)));
        string dir = UnB64(Arg(parts, 5));
        string cookies = UnB64(Arg(parts, 6));

        if (id.Length == 0 || url.Length == 0)
        {
            Send("{\"ev\":\"err\",\"id\":" + Jid(id) + ",\"m\":" + Js("Eksik indirme bilgisi") + ",\"code\":-1}");
            return;
        }
        // Alan kayması koruması: URL yerine seçici/ad metni gelmişse net hata ver.
        if (url.IndexOf("://", StringComparison.Ordinal) < 0)
        {
            string peek = url.Length > 60 ? url.Substring(0, 60) : url;
            Send("{\"ev\":\"err\",\"id\":" + Jid(id) + ",\"m\":" + Js("Gecersiz indirme adresi: " + peek) + ",\"code\":-3}");
            return;
        }
        string exe = Path.Combine(exeDir, "yt-dlp.exe");
        if (!File.Exists(exe))
        {
            Send("{\"ev\":\"err\",\"id\":" + Jid(id) + ",\"m\":" + Js("yt-dlp.exe bulunamadı") + ",\"code\":-2}");
            return;
        }
        // Klasör boşsa İndirilenler kullanılır (alt klasör oluşturulmaz);
        // yalnızca kullanıcının açıkça yazdığı klasör yoksa oluşturulur.
        bool customDir = dir.Length > 0;
        if (!customDir) dir = DefaultDir();
        if (customDir)
        {
            try { Directory.CreateDirectory(dir); }
            catch { }
        }

        Download rec = new Download();
        rec.Id = id;
        rec.Selector = selector.Length > 0 ? selector : "bv*+ba/b";
        rec.Url = url;
        rec.Name = name;
        rec.Dir = dir;
        rec.Cookies = cookies;

        List<string> args = new List<string>();
        args.Add("--newline");
        args.Add("--no-color");
        args.Add("--no-quiet");
        args.Add("--no-warnings");
        args.Add("--no-simulate");
        args.Add("--no-playlist");
        args.Add("--no-mtime");
        args.Add("--socket-timeout");
        args.Add("20");
        args.Add("--progress-template");
        args.Add(PROGRESS_MARK + "%(progress.downloaded_bytes)s;%(progress.total_bytes)s;%(progress.total_bytes_estimate)s;%(progress.speed)s;%(progress.eta)s");
        args.Add("--print");
        args.Add("after_move:" + FILE_MARK + "%(filepath)s");
        args.Add("-f");
        args.Add(rec.Selector);
        args.Add("-P");
        args.Add(rec.Dir);
        args.Add("-o");
        args.Add(rec.Name + ".%(ext)s");
        string ffmpeg = FindFfmpeg();
        if (ffmpeg != null) args.Add("--ffmpeg-location=" + ffmpeg);
        if (rec.Cookies.Length > 0)
        {
            args.Add("--cookies-from-browser");
            args.Add(rec.Cookies);
        }
        args.Add("--");
        args.Add(rec.Url);

        ProcessStartInfo start = new ProcessStartInfo(exe, JoinArgs(args));
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.RedirectStandardInput = true;
        start.WorkingDirectory = rec.Dir;

        try
        {
            Process p = new Process();
            p.StartInfo = start;
            p.EnableRaisingEvents = false;
            p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null) HandleLine(rec, e.Data);
            };
            p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null) HandleLine(rec, e.Data);
            };
            p.Start();
            rec.Proc = p;
            rec.Pid = p.Id;
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            Send("{\"ev\":\"err\",\"id\":" + Jid(id) + ",\"m\":" + Js("Başlatılamadı: " + ex.Message) + ",\"code\":-3}");
            return;
        }

        lock (mapLock)
        {
            Download old;
            if (active.TryGetValue(id, out old) && old.Proc != null)
            {
                try { KillTree(old.Pid); } catch { }
            }
            active[id] = rec;
        }
        Send("{\"ev\":\"start\",\"id\":" + Jid(id) + ",\"pid\":" + rec.Pid.ToString(CultureInfo.InvariantCulture) + "}");

        ThreadPool.QueueUserWorkItem(delegate(object state)
        {
            Finish(rec);
        });
    }

    static void Finish(Download rec)
    {
        int exitCode = -1;
        long bytes = 0;
        try
        {
            rec.Proc.WaitForExit();
            exitCode = rec.Proc.ExitCode;
            try
            {
                if (rec.Proc.HasExited)
                {
                    // async okuma tamponlarının boşalmasını bekle
                    rec.Proc.WaitForExit();
                }
            }
            catch { }
            bytes = GetFileSize(rec.FinalPath);
        }
        catch { }
        lock (mapLock)
        {
            active.Remove(rec.Id);
        }
        if (rec.Canceled)
        {
            Send("{\"ev\":\"canceled\",\"id\":" + Jid(rec.Id) + "}");
            return;
        }
        if (exitCode == 0)
        {
            string final = rec.FinalPath;
            if (string.IsNullOrEmpty(final)) final = GuessOutput(rec);
            if (bytes == 0) bytes = GetFileSize(final);
            if (bytes == 0) bytes = rec.LastBytes;
            Send("{\"ev\":\"done\",\"id\":" + Jid(rec.Id) + ",\"f\":" + Js(final ?? "") + ",\"bytes\":" + bytes.ToString(CultureInfo.InvariantCulture) + "}");
        }
        else
        {
            string msg = rec.LastError;
            if (string.IsNullOrEmpty(msg)) msg = "yt-dlp hata kodu: " + exitCode.ToString(CultureInfo.InvariantCulture);
            Send("{\"ev\":\"err\",\"id\":" + Jid(rec.Id) + ",\"m\":" + Js(msg) + ",\"code\":" + exitCode.ToString(CultureInfo.InvariantCulture) + "}");
        }
    }

    static void HandleLine(Download rec, string line)
    {
        string s = line.Trim();
        if (s.Length == 0) return;
        if (s.StartsWith(FILE_MARK, StringComparison.Ordinal))
        {
            rec.FinalPath = s.Substring(FILE_MARK.Length).Trim();
            return;
        }
        if (s.StartsWith(PROGRESS_MARK, StringComparison.Ordinal))
        {
            string[] f = s.Substring(PROGRESS_MARK.Length).Split(';');
            long d = ParseNum(f, 0);
            long t = ParseNum(f, 1);
            long te = ParseNum(f, 2);
            long sp = ParseNum(f, 3);
            long eta = ParseNum(f, 4);
            if (t <= 0) t = te;
            if (d >= 0) rec.LastBytes = d;
            if (t > 0) rec.LastTotal = t;
            if (sp > 0) rec.LastSpeed = sp;
            if (eta > 0) rec.LastEta = eta;
            long now = NowMs();
            if (now - rec.LastSentMs >= MIN_PROGRESS_MS || d < 0)
            {
                rec.LastSentMs = now;
                Send("{\"ev\":\"p\",\"id\":" + Jid(rec.Id) + ",\"d\":" + Math.Max(0, d).ToString(CultureInfo.InvariantCulture) +
                     ",\"t\":" + (t > 0 ? t : -1).ToString(CultureInfo.InvariantCulture) +
                     ",\"s\":" + Math.Max(0, sp).ToString(CultureInfo.InvariantCulture) +
                     ",\"e\":" + Math.Max(0, eta).ToString(CultureInfo.InvariantCulture) + "}");
            }
            return;
        }
        if (s.IndexOf("ERROR:", StringComparison.Ordinal) >= 0)
        {
            rec.LastError = s;
        }
        else if (s.IndexOf("ERROR ", StringComparison.Ordinal) >= 0 && rec.LastError == null)
        {
            rec.LastError = s;
        }
    }

    // yt-dlp ilerleme alanlarını sayıya çevirir. Değerler ondalıklı olabilir
    // (ör. hız "6614386.87"); bu yüzden double üzerinden ayrıştırılır.
    // Ayrıştırılamayan/geçersiz alanlar -1 döner ("N/A", boş, NaN...).
    static long ParseNum(string[] f, int i)
    {
        if (i >= f.Length) return -1;
        string s = f[i];
        if (string.IsNullOrEmpty(s)) return -1;
        double d;
        if (double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out d))
        {
            if (double.IsNaN(d) || double.IsInfinity(d) || d < 0) return -1;
            if (d > 9.0e18) return -1;
            return (long)d;
        }
        return -1;
    }

    static void CmdCancel(string[] parts)
    {
        string id = Arg(parts, 1);
        Download rec;
        lock (mapLock)
        {
            active.TryGetValue(id, out rec);
        }
        if (rec == null) return;
        rec.Canceled = true;
        try { KillTree(rec.Pid); } catch { }
    }

    static void CmdReveal(string[] parts)
    {
        string id = Arg(parts, 1);
        string path = UnB64(Arg(parts, 2));
        bool ok = false;
        try
        {
            // Dosya yolu geldiyse klasörünü, klasör yolu geldiyse kendisini
            // dümdüz aç: dosya seçilmez, gezinti ağacı uzatılmaz.
            string dir = null;
            if (path.Length > 0)
            {
                if (Directory.Exists(path)) dir = path;
                else dir = Path.GetDirectoryName(path);
            }
            if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir))
            {
                Process.Start(new ProcessStartInfo("explorer.exe", Quote(dir)) { UseShellExecute = true });
                ok = true;
            }
        }
        catch { }
        Send("{\"ev\":\"reveal\",\"id\":" + Jid(id) + ",\"ok\":" + (ok ? "1" : "0") + "}");
    }

    // Klasör seçme penceresi: yalnızca kullanıcı istediğinde (Ayarlar > Gözat) açılır.
    // Pencere kapanana kadar bu komut bekler; iptal edilirse boş yol döner.
    static void CmdPickDir(string[] parts)
    {
        string id = Arg(parts, 1);
        string initial = UnB64(Arg(parts, 2));
        string picked = "";
        try
        {
            Thread t = new Thread(delegate()
            {
                try
                {
                    System.Windows.Forms.Application.EnableVisualStyles();
                    string start = initial;
                    if (string.IsNullOrEmpty(start) || !Directory.Exists(start)) start = DefaultDir();
                    using (System.Windows.Forms.FolderBrowserDialog dlg = new System.Windows.Forms.FolderBrowserDialog())
                    {
                        dlg.Description = "Indirme klasoru secin";
                        dlg.ShowNewFolderButton = true;
                        if (!string.IsNullOrEmpty(start) && Directory.Exists(start)) dlg.SelectedPath = start;
                        using (System.Windows.Forms.Form owner = new System.Windows.Forms.Form())
                        {
                            // Tarayıcı ön planda olsa bile pencerenin görünmesini sağlar.
                            owner.TopMost = true;
                            owner.ShowInTaskbar = false;
                            owner.FormBorderStyle = System.Windows.Forms.FormBorderStyle.None;
                            owner.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
                            owner.Width = 1;
                            owner.Height = 1;
                            owner.Opacity = 0.01;
                            owner.Show();
                            System.Windows.Forms.DialogResult res = dlg.ShowDialog(owner);
                            if (res == System.Windows.Forms.DialogResult.OK) picked = dlg.SelectedPath;
                            owner.Close();
                        }
                    }
                }
                catch { }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.IsBackground = true;
            t.Start();
            t.Join();
        }
        catch { }
        Send("{\"ev\":\"dir\",\"id\":" + Jid(id) + ",\"p\":" + Js(picked) + "}");
    }

    // ---------- yardımcılar ----------

    static long NowMs()
    {
        return (long)(Stopwatch.GetTimestamp() / (Stopwatch.Frequency / 1000));
    }

    static string SanitizeName(string name)
    {
        if (string.IsNullOrEmpty(name)) return "video";
        StringBuilder sb = new StringBuilder(name.Length);
        char[] bad = new char[] { '\\', '/', ':', '*', '?', '"', '<', '>', '|' };
        foreach (char c in name)
        {
            if (c < 32 || Array.IndexOf(bad, c) >= 0) sb.Append(' ');
            else sb.Append(c);
        }
        string s = sb.ToString().Trim().TrimEnd('.');
        while (s.IndexOf("  ", StringComparison.Ordinal) >= 0) s = s.Replace("  ", " ");
        if (s.Length > 150) s = s.Substring(0, 150).Trim();
        return s.Length > 0 ? s : "video";
    }

    // Varsayılan indirme klasörü: kullanıcının İndirilenler klasörü (alt klasör açılmaz).
    static string DefaultDir()
    {
        string downloads = KnownFolder("374DE290-123F-4565-9164-39C4925E467B");
        if (string.IsNullOrEmpty(downloads))
        {
            downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        }
        return downloads;
    }

    static string KnownFolder(string guid)
    {
        try
        {
            IntPtr p;
            if (SHGetKnownFolderPath(new Guid(guid), 0, IntPtr.Zero, out p) == 0 && p != IntPtr.Zero)
            {
                string s = Marshal.PtrToStringUni(p);
                Marshal.FreeCoTaskMem(p);
                return s;
            }
        }
        catch { }
        return null;
    }

    static string FindFfmpeg()
    {
        string local = Path.Combine(exeDir, "ffmpeg.exe");
        if (File.Exists(local)) return local;
        string pathVar = Environment.GetEnvironmentVariable("PATH");
        if (!string.IsNullOrEmpty(pathVar))
        {
            foreach (string part in pathVar.Split(';'))
            {
                try
                {
                    string dir = part.Trim().Trim('"');
                    if (dir.Length == 0) continue;
                    string candidate = Path.Combine(dir, "ffmpeg.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
        }
        return null;
    }

    static long GetFileSize(string path)
    {
        try
        {
            if (string.IsNullOrEmpty(path)) return 0;
            FileInfo fi = new FileInfo(path);
            return fi.Exists ? fi.Length : 0;
        }
        catch { return 0; }
    }

    static string GuessOutput(Download rec)
    {
        try
        {
            DirectoryInfo di = new DirectoryInfo(rec.Dir);
            if (!di.Exists) return "";
            FileInfo best = null;
            foreach (FileInfo fi in di.GetFiles(rec.Name + ".*"))
            {
                if (fi.Extension == ".part" || fi.Extension == ".ytdl") continue;
                if (best == null || fi.LastWriteTimeUtc > best.LastWriteTimeUtc) best = fi;
            }
            return best != null ? best.FullName : "";
        }
        catch { return ""; }
    }

    static void KillAll()
    {
        List<Download> list = new List<Download>();
        lock (mapLock)
        {
            list.AddRange(active.Values);
            active.Clear();
        }
        foreach (Download rec in list)
        {
            rec.Canceled = true;
            try { KillTree(rec.Pid); } catch { }
        }
    }

    static void KillTree(int pid)
    {
        if (pid <= 0) return;
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("taskkill.exe", "/PID " + pid.ToString(CultureInfo.InvariantCulture) + " /T /F");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            using (Process p = Process.Start(psi))
            {
                p.StandardOutput.ReadToEnd();
                p.StandardError.ReadToEnd();
                p.WaitForExit(5000);
            }
        }
        catch { }
    }

    static string JoinArgs(List<string> args)
    {
        StringBuilder sb = new StringBuilder();
        foreach (string a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(Quote(a));
        }
        return sb.ToString();
    }

    // Windows komut satırı kaçışlama (CommandLineToArgvW kuralları)
    static string Quote(string s)
    {
        if (s == null) s = "";
        StringBuilder sb = new StringBuilder();
        sb.Append('"');
        int backslashes = 0;
        foreach (char c in s)
        {
            if (c == '\\')
            {
                backslashes++;
                sb.Append(c);
            }
            else if (c == '"')
            {
                sb.Append('\\', backslashes + 1);
                sb.Append('"');
                backslashes = 0;
            }
            else
            {
                backslashes = 0;
                sb.Append(c);
            }
        }
        if (backslashes > 0) sb.Append('\\', backslashes);
        sb.Append('"');
        return sb.ToString();
    }

    [DllImport("shell32.dll")]
    static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid rfid, uint dwFlags, IntPtr hToken, out IntPtr ppszPath);
}
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
