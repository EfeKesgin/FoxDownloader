// FoxDownloader - kurulum/kaldirma arayuzlerinin ortak katmani.
// Gomulu kaynaklar, PowerShell calistirma, eklenti cikarma, tarayici bulma.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

namespace FoxDownloader
{
    internal static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(22, 20, 18);
        public static readonly Color Surface = Color.FromArgb(32, 28, 25);
        public static readonly Color Surface2 = Color.FromArgb(41, 36, 32);
        public static readonly Color Border = Color.FromArgb(58, 51, 45);
        public static readonly Color Text = Color.FromArgb(243, 237, 228);
        public static readonly Color Muted = Color.FromArgb(168, 157, 145);
        public static readonly Color Accent = Color.FromArgb(220, 122, 61);
        public static readonly Color Accent2 = Color.FromArgb(199, 106, 51);
        public static readonly Color Ok = Color.FromArgb(138, 184, 111);
        public static readonly Color Err = Color.FromArgb(205, 106, 96);
        public static readonly Color Dark = Color.FromArgb(34, 22, 15);
    }

    internal static class Core
    {
        public static string ExtDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FoxDownloader",
                "Eklenti");
        }

        public static string HelperDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FoxDownloaderHelper");
        }

        // Gomulu kaynagi diske cikarir.
        public static void ExtractResource(string name, string outFile)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (s == null) throw new Exception("Gomulu kaynak bulunamadi: " + name);
                using (FileStream f = File.Create(outFile))
                {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = s.Read(buf, 0, buf.Length)) > 0) f.Write(buf, 0, n);
                }
            }
        }

        // Gomulu PowerShell betigini gecici klasore yazar, tam yolunu doner.
        public static string WriteTempScript(string resourceName)
        {
            string tmp = Path.Combine(Path.GetTempPath(), "FoxDownloader-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tmp);
            string ps1 = Path.Combine(tmp, "script.ps1");
            ExtractResource(resourceName, ps1);
            return ps1;
        }

        // PowerShell betigini calistirir; cikti satirlarini onLine'a iletir.
        public static int RunPowerShell(string ps1, string vdhArgs, Action<string> onLine)
        {
            string psExe = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe");
            if (!File.Exists(psExe)) psExe = "powershell.exe";

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = psExe;
            psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + ps1 + "\"";
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["VDH_ARGS"] = vdhArgs;

            Process p = new Process();
            p.StartInfo = psi;
            DataReceivedEventHandler handler = delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data != null && onLine != null) onLine(e.Data);
            };
            p.OutputDataReceived += handler;
            p.ErrorDataReceived += handler;
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();
            return p.ExitCode;
        }

        // Eklenti zip'ini %LOCALAPPDATA%\FoxDownloader\Eklenti klasorune acar.
        public static int ExtractExtension()
        {
            string zip = Path.Combine(Path.GetTempPath(), "fox-eklenti-" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                ExtractResource("FoxEklenti.zip", zip);
                string dir = ExtDir();
                try { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
                catch { }
                Directory.CreateDirectory(dir);
                using (ZipArchive za = ZipFile.OpenRead(zip))
                {
                    foreach (ZipArchiveEntry e in za.Entries)
                    {
                        string rel = e.FullName.Replace('/', Path.DirectorySeparatorChar);
                        string target = Path.Combine(dir, rel);
                        if (string.IsNullOrEmpty(e.Name))
                        {
                            Directory.CreateDirectory(target);
                            continue;
                        }
                        string parent = Path.GetDirectoryName(target);
                        if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                        e.ExtractToFile(target, true);
                    }
                }
                return 0;
            }
            catch (Exception ex)
            {
                Log("Kur", "Eklenti klasoru cikarilamadi: " + ex.Message);
                return 3;
            }
            finally
            {
                try { if (File.Exists(zip)) File.Delete(zip); }
                catch { }
            }
        }

        // Calisan yardimci surecleri durdurur (dosya kilitlerini acar).
        public static void KillHelper()
        {
            try
            {
                foreach (Process pr in Process.GetProcessesByName("ythelper"))
                {
                    try { pr.Kill(); }
                    catch { }
                }
            }
            catch { }
        }

        public static string TempLogPath(string kind)
        {
            return Path.Combine(Path.GetTempPath(), "FoxDownloader-" + kind + ".log");
        }

        public static void Log(string kind, string line)
        {
            try
            {
                File.AppendAllText(TempLogPath(kind),
                    DateTime.Now.ToString("HH:mm:ss") + "  " + line + "\r\n", Encoding.UTF8);
            }
            catch { }
        }
    }

    internal sealed class BrowserInfo
    {
        public string Name;
        public string Exe;
        public string Scheme;
        public override string ToString() { return Name; }
    }

    internal static class Browsers
    {
        private static void Add(List<BrowserInfo> list, string name, string scheme, params string[] candidates)
        {
            foreach (string c in candidates)
            {
                if (!string.IsNullOrEmpty(c) && File.Exists(c))
                {
                    BrowserInfo b = new BrowserInfo();
                    b.Name = name;
                    b.Scheme = scheme;
                    b.Exe = c;
                    list.Add(b);
                    return;
                }
            }
        }

        public static List<BrowserInfo> Detect()
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string lad = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            List<BrowserInfo> list = new List<BrowserInfo>();
            Add(list, "Brave", "brave",
                Path.Combine(pf, @"BraveSoftware\Brave-Browser\Application\brave.exe"),
                Path.Combine(pf86, @"BraveSoftware\Brave-Browser\Application\brave.exe"),
                Path.Combine(lad, @"BraveSoftware\Brave-Browser\Application\brave.exe"));
            Add(list, "Google Chrome", "chrome",
                Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(lad, @"Google\Chrome\Application\chrome.exe"));
            Add(list, "Microsoft Edge", "edge",
                Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"));
            Add(list, "Vivaldi", "vivaldi",
                Path.Combine(lad, @"Vivaldi\Application\vivaldi.exe"),
                Path.Combine(pf, @"Vivaldi\Application\vivaldi.exe"));
            Add(list, "Opera", "opera",
                Path.Combine(lad, @"Programs\Opera\opera.exe"),
                Path.Combine(lad, @"Programs\Opera GX\opera.exe"),
                Path.Combine(pf, @"Opera\opera.exe"));
            return list;
        }

        public static void OpenExtensionsPage(BrowserInfo b, IWin32Window owner)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(b.Exe, b.Scheme + "://extensions/");
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show(owner, "Tarayici acilamadi: " + ex.Message, "FoxDownloader",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }
}
