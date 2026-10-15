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
