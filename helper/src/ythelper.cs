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
//   dl|id|<seçici>|<url>|<ad>|<dizin>|<çerez>|<bayraklar> → indirme başlat (base64 alanlar)
//   upd|id                                  → yt-dlp'yi güncelle (yt-dlp -U)
//   cancel|id                               → indirmeyi iptal et
//   reveal|id|<yol>                         → klasörde göster
//   pickdir|id|<başlangıç dizini>           → klasör seçme penceresi aç (base64)
//   quit                                    → çık
//
// Not: <dizin> boş gelirse dosya kullanıcının İndirilenler klasörüne iner;
// yardımcı kendiliğinden alt klasör OLUŞTURMAZ (tek istisna: oynatma listeleri
// liste adıyla açılan bir klasöre iner).
//
// <bayraklar> virgülle ayrılmış isteğe bağlı seçeneklerdir (bilinmeyenler yok sayılır):
//   pl    → oynatma listesinin tamamını indir
//   mp3   → sesi MP3'e dönüştür
//   subs  → altyazıları (TR/EN) videoya göm
//   thumb → kapak resmini dosyaya göm
//   meta  → başlık/kanal/tarih bilgisini dosyaya yaz
//   hq1080 → en iyi kaynağı (4K/1440p) indirip FFmpeg ile 1080p H.264 MP4'e küçült
//            (YouTube'un kendi 1080p akışı ~2.5 Mbps'ye sıkıştırılmış olduğu için)
//
// Gönderilen olaylar (JSON nesnesi):
//   {"ev":"hello","id":...,"v":2,"ytdlp":1,"ffmpeg":1,"deno":1,"dir":"<b64>","ytdlpV":"<b64>"}
//   {"ev":"ver","id":...,"v":"<b64>"}
//   {"ev":"start","id":...} | {"ev":"err","id":...,"m":"<b64>","code":N}
//   {"ev":"p","id":...,"d":N,"t":N,"s":N,"e":N,"i":N,"n":N}   (i/n: liste sırası/toplamı)
//   {"ev":"done","id":...,"f":"<b64>","bytes":N,"files":N,"w":"<b64>"}
//   {"ev":"upd","id":...,"ok":1,"changed":1,"v":"<b64>","m":"<b64>"}
//   {"ev":"enc","id":...,"pct":N}                               (hq1080 dönüştürme ilerlemesi)
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
using System.Text.RegularExpressions;
using System.Threading;

static class Program
{
    const string PROGRESS_MARK = "@@@P:";
    const string FILE_MARK = "@@@FILE:";
    const int MAX_FRAME = 8 * 1024 * 1024;
    const int MIN_PROGRESS_MS = 250;
    const int HELPER_VERSION = 2;

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
        public HashSet<string> Flags;
        public Process Proc;
        public int Pid;
        public long LastSentMs;
        public long LastBytes;
        public long LastSpeed;
        public long LastEta;
        public long LastTotal;
        public long LastIndex;
        public long LastCount;
        public int FilesDone;
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
            else if (cmd == "upd") CmdUpdate(parts);
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
             ",\"v\":" + HELPER_VERSION.ToString(CultureInfo.InvariantCulture) +
             ",\"ytdlp\":" + (hasYtdlp ? "1" : "0") +
             ",\"ffmpeg\":" + (FindFfmpeg() != null ? "1" : "0") +
             ",\"deno\":" + (FindDeno() != null ? "1" : "0") +
             ",\"dir\":" + Js(DefaultDir()) +
             ",\"exe\":" + Js(exeDir) +
             ",\"ytdlpV\":" + Js(version) + "}");
    }

    static void CmdVersion(string[] parts)
    {
        string id = Arg(parts, 1);
        ThreadPool.QueueUserWorkItem(delegate(object state)
        {
            string version = QueryVersion();
            Send("{\"ev\":\"ver\",\"id\":" + Jid(id) + ",\"v\":" + Js(version) + "}");
        });
    }

    // yt-dlp --version çalıştırır ve sonucu version.txt'ye yazar.
    static string QueryVersion()
    {
        string version = "";
        try
        {
            string exe = Path.Combine(exeDir, "yt-dlp.exe");
            if (File.Exists(exe))
            {
                string output;
                RunCapture(exe, "--version", 180000, out output);
                version = LastMeaningfulLine(output);
                if (version.Length > 0)
                {
                    try { File.WriteAllText(Path.Combine(exeDir, "version.txt"), version); } catch { }
                }
            }
        }
        catch { }
        return version;
    }

    // Süreci çalıştırır, stdout+stderr çıktısını toplar ve çıkış kodunu döner.
    static int RunCapture(string exe, string arguments, int timeoutMs, out string output)
    {
        ProcessStartInfo psi = new ProcessStartInfo(exe, arguments);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        // stdin yönlendirilmezse alt süreç native messaging borusunu miras alır
        // (yt-dlp -U bu durumda hiç bitmiyor).
        psi.RedirectStandardInput = true;
        psi.WorkingDirectory = exeDir;
        StringBuilder sb = new StringBuilder();
        ManualResetEvent outDone = new ManualResetEvent(false);
        ManualResetEvent errDone = new ManualResetEvent(false);
        using (Process p = new Process())
        {
            p.StartInfo = psi;
            p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data == null) outDone.Set();
                else lock (sb) sb.AppendLine(e.Data);
            };
            p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data == null) errDone.Set();
                else lock (sb) sb.AppendLine(e.Data);
            };
            p.Start();
            try { p.StandardInput.Close(); } catch { }
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            int code = -1;
            if (p.WaitForExit(timeoutMs))
            {
                // Parametresiz WaitForExit() kullanılmaz: "yt-dlp -U" dosyayı değiştirmek
                // için bir cmd süreci bırakır, o da boruları açık tuttuğundan sonsuza dek
                // beklenirdi. Tamponların boşalması için kısa ve sınırlı beklenir.
                outDone.WaitOne(3000);
                errDone.WaitOne(3000);
                code = p.ExitCode;
            }
            else
            {
                try { KillTree(p.Id); } catch { }
            }
            lock (sb) output = sb.ToString();
            return code;
        }
    }

    // yt-dlp kendini günceller (yt-dlp -U; yeni dosyayı yt-dlp kendisi SHA2-256SUMS
    // ile doğrular). İndirme sürerken exe kilitli olduğu için istek reddedilir.
    static int updating;

    static void CmdUpdate(string[] parts)
    {
        string id = Arg(parts, 1);
        int busy;
        lock (mapLock) busy = active.Count;
        if (busy > 0)
        {
            SendUpdate(id, false, false, "", "İndirme sürüyor; güncelleme sonra yapılacak");
            return;
        }
        if (Interlocked.Exchange(ref updating, 1) == 1)
        {
            SendUpdate(id, false, false, "", "Güncelleme zaten sürüyor");
            return;
        }
        ThreadPool.QueueUserWorkItem(delegate(object state)
        {
            bool ok = false;
            bool changed = false;
            string msg = "";
            string version = "";
            try
            {
                string exe = Path.Combine(exeDir, "yt-dlp.exe");
                if (!File.Exists(exe))
                {
                    msg = "yt-dlp.exe bulunamadı";
                }
                else
                {
                    string before = QueryVersion();
                    string output;
                    int code = RunCapture(exe, "-U", 300000, out output);
                    version = QueryVersion();
                    ok = code == 0;
                    changed = version.Length > 0 && version != before;
                    msg = LastMeaningfulLine(output);
                }
            }
            catch (Exception ex)
            {
                msg = ex.Message;
            }
            finally
            {
                Interlocked.Exchange(ref updating, 0);
            }
            SendUpdate(id, ok, changed, version, msg);
        });
    }

    static void SendUpdate(string id, bool ok, bool changed, string version, string msg)
    {
        Send("{\"ev\":\"upd\",\"id\":" + Jid(id) + ",\"ok\":" + (ok ? "1" : "0") +
             ",\"changed\":" + (changed ? "1" : "0") + ",\"v\":" + Js(version) + ",\"m\":" + Js(msg) + "}");
    }

    static string LastMeaningfulLine(string text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        string[] lines = text.Replace("\r", "").Split('\n');
        for (int i = lines.Length - 1; i >= 0; i--)
        {
            string l = lines[i].Trim();
            if (l.Length > 0) return l.Length > 300 ? l.Substring(0, 300) : l;
        }
        return "";
    }

    static void CmdDownload(string[] parts)
    {
        string id = Arg(parts, 1);
        string selector = UnB64(Arg(parts, 2));
        string url = UnB64(Arg(parts, 3));
        string name = SanitizeName(UnB64(Arg(parts, 4)));
        string dir = UnB64(Arg(parts, 5));
        string cookies = UnB64(Arg(parts, 6));
        HashSet<string> flags = ParseFlags(UnB64(Arg(parts, 7)));

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
        if (Volatile.Read(ref updating) == 1)
        {
            Send("{\"ev\":\"err\",\"id\":" + Jid(id) + ",\"m\":" + Js("YT_DLP_GUNCELLENIYOR") + ",\"code\":-4}");
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
        rec.Flags = flags;
        bool playlist = flags.Contains("pl");
        string ffmpeg = FindFfmpeg();

        List<string> args = new List<string>();
        args.Add("--newline");
        args.Add("--no-color");
        args.Add("--no-quiet");
        args.Add("--no-warnings");
        args.Add("--no-simulate");
        args.Add(playlist ? "--yes-playlist" : "--no-playlist");
        args.Add("--no-mtime");
        args.Add("--socket-timeout");
        args.Add("20");
        args.Add("--progress-template");
        args.Add(PROGRESS_MARK + "%(progress.downloaded_bytes)s;%(progress.total_bytes)s;%(progress.total_bytes_estimate)s;%(progress.speed)s;%(progress.eta)s;%(info.playlist_index)s;%(info.n_entries)s");
        args.Add("--print");
        args.Add("after_move:" + FILE_MARK + "%(filepath)s");
        args.Add("-f");
        args.Add(rec.Selector);
        args.Add("-P");
        args.Add(rec.Dir);
        args.Add("-o");
        // Ad, yt-dlp çıktı şablonuna girer: başlıktaki '%' kaçışlanır, yoksa
        // "%(id)s" gibi bir metin şablon alanı sanılıp genişletilir.
        string safeName = rec.Name.Replace("%", "%%");
        // hq1080: önce en iyi kaynak ".kaynak" ekiyle iner, sonra 1080p MP4'e dönüştürülür.
        string single = flags.Contains("hq1080") ? safeName + ".kaynak.%(ext)s" : safeName + ".%(ext)s";
        args.Add(playlist ? safeName + "\\%(playlist_index)03d - %(title)s.%(ext)s" : single);
        if (ffmpeg != null) args.Add("--ffmpeg-location=" + ffmpeg);
        string deno = FindDeno();
        if (deno != null)
        {
            args.Add("--js-runtimes");
            args.Add("deno:" + deno);
        }
        if (flags.Contains("mp3") && ffmpeg != null)
        {
            args.Add("-x");
            args.Add("--audio-format");
            args.Add("mp3");
            args.Add("--audio-quality");
            args.Add("0");
        }
        if (flags.Contains("subs"))
        {
            // FFmpeg varsa altyazı dosyaya gömülür ve .vtt silinir; yoksa yanına yazılır.
            args.Add(ffmpeg != null ? "--embed-subs" : "--write-subs");
            args.Add("--sub-langs");
            args.Add("tr.*,en.*,-live_chat");
        }
        if (flags.Contains("thumb") && ffmpeg != null) args.Add("--embed-thumbnail");
        if (flags.Contains("meta") && ffmpeg != null) args.Add("--embed-metadata");
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

        // Yüksek kalite 1080p: indirilen 4K/1440p kaynak küçültülür. Kayıt bu sırada
        // "active" içinde kalır ki iptal komutu kodlayıcıyı da durdurabilsin.
        string encodeWarning = "";
        if (exitCode == 0 && !rec.Canceled && rec.Flags.Contains("hq1080"))
        {
            string src = string.IsNullOrEmpty(rec.FinalPath) ? GuessOutput(rec) : rec.FinalPath;
            string encoded = Transcode1080(rec, src);
            if (encoded != null)
            {
                rec.FinalPath = encoded;
                bytes = GetFileSize(encoded);
            }
            else if (!rec.Canceled)
            {
                encodeWarning = "1080p'ye dönüştürülemedi; dosya orijinal çözünürlükte bırakıldı";
            }
        }

        lock (mapLock)
        {
            active.Remove(rec.Id);
        }
        if (rec.Canceled)
        {
            Send("{\"ev\":\"canceled\",\"id\":" + Jid(rec.Id) + "}");
            return;
        }
        // Oynatma listesinde tek videonun hatası (silinmiş/özel video) tüm işi
        // başarısız saymaz: en az bir dosya indiyse uyarıyla "bitti" bildirilir.
        bool partial = exitCode != 0 && rec.Flags.Contains("pl") && rec.FilesDone > 0;
        if (exitCode == 0 || partial)
        {
            string final = rec.FinalPath;
            if (string.IsNullOrEmpty(final)) final = GuessOutput(rec);
            if (bytes == 0) bytes = GetFileSize(final);
            if (bytes == 0) bytes = rec.LastBytes;
            Send("{\"ev\":\"done\",\"id\":" + Jid(rec.Id) + ",\"f\":" + Js(final ?? "") +
                 ",\"bytes\":" + bytes.ToString(CultureInfo.InvariantCulture) +
                 ",\"files\":" + rec.FilesDone.ToString(CultureInfo.InvariantCulture) +
                 ",\"w\":" + Js(partial ? (rec.LastError ?? "") : encodeWarning) + "}");
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
            rec.FilesDone++;
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
            long idx = ParseNum(f, 5);
            long cnt = ParseNum(f, 6);
            if (idx > 0) rec.LastIndex = idx;
            if (cnt > 0) rec.LastCount = cnt;
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
                     ",\"e\":" + Math.Max(0, eta).ToString(CultureInfo.InvariantCulture) +
                     ",\"i\":" + rec.LastIndex.ToString(CultureInfo.InvariantCulture) +
                     ",\"n\":" + rec.LastCount.ToString(CultureInfo.InvariantCulture) + "}");
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

    // ---------- yüksek kalite 1080p dönüştürme ----------

    // Sırayla denenen H.264 kodlayıcıları: önce ekran kartı (hızlı), en son işlemci.
    // FFmpeg derlemesi hepsini listeler ama donanım yoksa kodlayıcı hemen hata verir.
    static readonly string[] Encoders = new string[]
    {
        "-c:v h264_nvenc -preset p6 -tune hq -rc vbr -cq 21 -b:v 0 -profile:v high",
        "-c:v h264_qsv -preset slower -global_quality 22",
        "-c:v h264_amf -quality quality -rc cqp -qp_i 20 -qp_p 22 -qp_b 24",
        "-c:v libx264 -preset fast -crf 20"
    };

    // Kaynağı 1920x1080 (dikey videoda 1080x1920) kutusuna sığacak şekilde küçültür.
    // Dönüş: yeni dosya yolu; kaynak zaten küçükse yeniden adlandırılmış kaynak;
    // başarısızlık/iptalde null (kaynak dosya yerinde kalır).
    static string Transcode1080(Download rec, string src)
    {
        string ffmpeg = FindFfmpeg();
        if (ffmpeg == null || string.IsNullOrEmpty(src) || !File.Exists(src)) return null;
        int w, h;
        double duration;
        ProbeVideo(ffmpeg, src, out w, out h, out duration);
        if (w <= 0 || h <= 0) return null;

        bool portrait = h > w;
        int boxW = portrait ? 1080 : 1920;
        int boxH = portrait ? 1920 : 1080;
        string ext = Path.GetExtension(src);
        if (w <= boxW && h <= boxH)
        {
            // Daha yüksek kaynak yokmuş: dönüştürmeye gerek yok, ".kaynak" eki atılır.
            string plain = Path.Combine(rec.Dir, rec.Name + ext);
            try
            {
                if (!File.Exists(plain)) File.Move(src, plain);
                return File.Exists(plain) ? plain : src;
            }
            catch
            {
                return src;
            }
        }

        string dst = Path.Combine(rec.Dir, rec.Name + ".mp4");
        string vf = "scale=w=" + boxW + ":h=" + boxH +
                    ":force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos";
        foreach (string enc in Encoders)
        {
            if (rec.Canceled) break;
            string arguments = "-hide_banner -nostats -loglevel error -y -i " + Quote(src) +
                " -map 0:v:0 -map 0:a:0? -map 0:s? -vf " + Quote(vf) + " " + enc +
                " -pix_fmt yuv420p -c:a aac -b:a 192k -c:s mov_text -movflags +faststart -progress pipe:1 " + Quote(dst);
            int code = RunEncode(rec, ffmpeg, arguments, duration);
            if (code == 0 && !rec.Canceled && GetFileSize(dst) > 0)
            {
                try { File.Delete(src); } catch { }
                return dst;
            }
            try { File.Delete(dst); } catch { }
        }
        // İptalde ara kaynak dosya da silinir (indirme klasöründe ".kaynak" artığı kalmasın).
        if (rec.Canceled)
        {
            try { File.Delete(src); } catch { }
        }
        return null;
    }

    // "ffmpeg -i" çıktısından çözünürlük ve süre okunur (ffprobe her sistemde yok).
    static void ProbeVideo(string ffmpeg, string path, out int w, out int h, out double duration)
    {
        w = 0;
        h = 0;
        duration = 0;
        string output;
        try
        {
            RunCapture(ffmpeg, "-hide_banner -i " + Quote(path), 60000, out output);
        }
        catch
        {
            return;
        }
        Match d = Regex.Match(output, @"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)");
        if (d.Success)
        {
            duration = int.Parse(d.Groups[1].Value, CultureInfo.InvariantCulture) * 3600 +
                       int.Parse(d.Groups[2].Value, CultureInfo.InvariantCulture) * 60 +
                       double.Parse(d.Groups[3].Value, CultureInfo.InvariantCulture);
        }
        Match v = Regex.Match(output, @"Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b");
        if (v.Success)
        {
            w = int.Parse(v.Groups[1].Value, CultureInfo.InvariantCulture);
            h = int.Parse(v.Groups[2].Value, CultureInfo.InvariantCulture);
        }
    }

    // ffmpeg'i çalıştırır; "-progress pipe:1" satırlarından yüzde hesaplayıp "enc" olayı yollar.
    static int RunEncode(Download rec, string ffmpeg, string arguments, double duration)
    {
        ProcessStartInfo psi = new ProcessStartInfo(ffmpeg, arguments);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.RedirectStandardInput = true;
        psi.WorkingDirectory = rec.Dir;
        long lastSent = 0;
        using (Process p = new Process())
        {
            p.StartInfo = psi;
            p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data == null || duration <= 0) return;
                if (!e.Data.StartsWith("out_time_us=", StringComparison.Ordinal) &&
                    !e.Data.StartsWith("out_time_ms=", StringComparison.Ordinal)) return;
                long us;
                if (!long.TryParse(e.Data.Substring(12), NumberStyles.Integer, CultureInfo.InvariantCulture, out us)) return;
                long now = NowMs();
                if (now - lastSent < 500) return;
                lastSent = now;
                int pct = (int)Math.Max(0, Math.Min(99, us / (duration * 10000.0)));
                Send("{\"ev\":\"enc\",\"id\":" + Jid(rec.Id) + ",\"pct\":" + pct.ToString(CultureInfo.InvariantCulture) + "}");
            };
            p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { };
            try
            {
                p.Start();
            }
            catch
            {
                return -1;
            }
            rec.Pid = p.Id; // iptal komutu artık kodlayıcıyı durdurur
            try { p.StandardInput.Close(); } catch { }
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();
            return p.ExitCode;
        }
    }

    static HashSet<string> ParseFlags(string text)
    {
        HashSet<string> set = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrEmpty(text)) return set;
        foreach (string raw in text.Split(','))
        {
            string f = raw.Trim().ToLowerInvariant();
            if (f == "pl" || f == "mp3" || f == "subs" || f == "thumb" || f == "meta" || f == "hq1080") set.Add(f);
        }
        return set;
    }

    static string FindFfmpeg()
    {
        return FindTool("ffmpeg.exe");
    }

    // yt-dlp'nin YouTube imza çözümü için istediği JS çalışma ortamı.
    static string FindDeno()
    {
        return FindTool("deno.exe");
    }

    // Önce yardımcı klasörüne, sonra PATH'e bakar.
    static string FindTool(string fileName)
    {
        string local = Path.Combine(exeDir, fileName);
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
                    string candidate = Path.Combine(dir, fileName);
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
