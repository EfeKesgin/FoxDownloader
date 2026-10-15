// FoxDownloader - kurulum arayuzu (FoxDownloader-Kur.exe).
// Gomulu kurulum betigini sessiz modda calistirir, eklentiyi cikarir ve
// tarayiciya yukleme adimlarini gosterir.
// Sessiz kullanim:  FoxDownloader-Kur.exe /sessiz
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace FoxDownloader
{
    internal static class KurProgram
    {
        [STAThread]
        private static void Main(string[] args)
        {
            bool headless = false;
            foreach (string a in args)
            {
                if (a.Equals("/sessiz", StringComparison.OrdinalIgnoreCase) ||
                    a.Equals("/silent", StringComparison.OrdinalIgnoreCase)) headless = true;
            }

            if (headless)
            {
                string log = Core.TempLogPath("Kur");
                try { if (File.Exists(log)) File.Delete(log); } catch { }
                Core.Log("Kur", "FoxDownloader sessiz kurulum basladi");
                Core.KillHelper();
                string ps1 = Core.WriteTempScript("FoxKur.ps1");
                int code = Core.RunPowerShell(ps1, "sessiz", delegate(string line) { Core.Log("Kur", line); });
                if (code == 0) code = Core.ExtractExtension();
                Core.Log("Kur", "Cikis kodu: " + code);
                Environment.Exit(code);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new KurForm());
        }
    }

    internal sealed class KurForm : Form
    {
        private Panel pnlSetup;
        private Panel pnlRun;
        private Panel pnlDone;
        private CheckBox chkFfmpeg;
        private Button btnStart;
        private Label lblStatus;
        private TextBox txtLog;
        private Button btnCopyLog;
        private Button btnRetry;
        private ComboBox cboBrowsers;
        private TextBox txtPath;
        private Button btnFinish;
        private List<BrowserInfo> browsers = new List<BrowserInfo>();
        private bool installRunning = false;

        public KurForm()
        {
            Text = "FoxDownloader Kurulumu";
            ClientSize = new Size(620, 390);
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Font = new Font("Segoe UI", 9f);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            BuildUi();
        }

        private static Label NewLabel(string text, float size, Color color, bool bold,
                                      int x, int y, int w, int h)
        {
            Label l = new Label();
            l.Text = text;
            l.ForeColor = color;
            l.BackColor = Color.Transparent;
            l.Font = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular);
            l.Location = new Point(x, y);
            l.Size = new Size(w, h);
            l.AutoSize = false;
            return l;
        }

        // kind: 0 = ikincil, 1 = birincil (turuncu), 2 = tehlike (kirmizi)
        private static Button NewButton(string text, int x, int y, int w, int h, int kind)
        {
            Button b = new Button();
            b.Text = text;
            b.Location = new Point(x, y);
            b.Size = new Size(w, h);
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 1;
            b.FlatAppearance.BorderColor = kind == 1 ? Theme.Accent : (kind == 2 ? Theme.Err : Theme.Border);
            b.BackColor = kind == 1 ? Theme.Accent : (kind == 2 ? Theme.Err : Theme.Surface2);
            b.ForeColor = kind == 0 ? Theme.Text : Theme.Dark;
            b.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            b.Cursor = Cursors.Hand;
            return b;
        }

        private static Panel NewPanel(int x, int y, int w, int h)
        {
            Panel p = new Panel();
            p.Location = new Point(x, y);
            p.Size = new Size(w, h);
            p.BackColor = Theme.Surface;
            p.Paint += delegate(object s, PaintEventArgs e)
            {
                e.Graphics.DrawRectangle(new Pen(Theme.Border), 0, 0, p.Width - 1, p.Height - 1);
            };
            return p;
        }

        private void BuildUi()
        {
            Controls.Add(NewLabel("FoxDownloader Kurulumu", 15f, Theme.Text, true, 22, 14, 420, 30));
            Controls.Add(NewLabel("Yardımcı servis + eklenti klasörü. Yönetici izni gerekmez.",
                9f, Theme.Muted, false, 24, 46, 500, 20));

            pnlSetup = NewPanel(22, 76, 576, 270);
            Controls.Add(pnlSetup);
            pnlRun = NewPanel(22, 76, 576, 270);
            pnlRun.Visible = false;
            Controls.Add(pnlRun);
            pnlDone = NewPanel(22, 76, 576, 270);
            pnlDone.Visible = false;
            Controls.Add(pnlDone);

            // ---------- Kurulum paneli ----------
            pnlSetup.Controls.Add(NewLabel("Kurulacaklar:", 9.5f, Theme.Text, true, 16, 14, 300, 20));
            pnlSetup.Controls.Add(NewLabel(
                "• Yardımcı servis (ythelper.exe) — yerel C# derleyicisiyle derlenir\r\n" +
                "• yt-dlp.exe (~18 MB, GitHub'dan indirilir)\r\n" +
                "• 6 tarayıcı için native messaging kaydı (HKCU — yönetici gerekmez)\r\n" +
                "• Eklenti klasörü: %LOCALAPPDATA%\\FoxDownloader\\Eklenti",
                9f, Theme.Muted, false, 16, 38, 545, 76));

            chkFfmpeg = new CheckBox();
            chkFfmpeg.Text = "FFmpeg de indir (~130 MB)";
            chkFfmpeg.Checked = true;
            chkFfmpeg.ForeColor = Theme.Text;
            chkFfmpeg.BackColor = Color.Transparent;
            chkFfmpeg.Location = new Point(14, 122);
            chkFfmpeg.Size = new Size(300, 22);
            pnlSetup.Controls.Add(chkFfmpeg);
            pnlSetup.Controls.Add(NewLabel(
                "1080p ve üzeri videolarda görüntü + ses birleştirmek için gereklidir. " +
                "FFmpeg sistemde zaten kuruluysa bu seçenek yok sayılır.",
                8.5f, Theme.Muted, false, 18, 146, 540, 34));

            btnStart = NewButton("Kurulumu Başlat", 16, 200, 210, 40, 1);
            btnStart.Click += delegate { StartInstall(); };
            pnlSetup.Controls.Add(btnStart);
            pnlSetup.Controls.Add(NewLabel("Süre: 1-3 dakika. Pencere kapanana kadar bekleyin.",
                8.5f, Theme.Muted, false, 238, 212, 320, 20));

            // ---------- İlerleme paneli ----------
            lblStatus = NewLabel("Hazırlanıyor...", 9.5f, Theme.Text, true, 16, 12, 545, 20);
            pnlRun.Controls.Add(lblStatus);

            ProgressBar bar = new ProgressBar();
            bar.Style = ProgressBarStyle.Marquee;
            bar.MarqueeAnimationSpeed = 30;
            bar.Location = new Point(16, 38);
            bar.Size = new Size(544, 16);
            pnlRun.Controls.Add(bar);

            txtLog = new TextBox();
            txtLog.Multiline = true;
            txtLog.ReadOnly = true;
            txtLog.ScrollBars = ScrollBars.Vertical;
            txtLog.BackColor = Color.FromArgb(18, 17, 16);
            txtLog.ForeColor = Theme.Muted;
            txtLog.BorderStyle = BorderStyle.FixedSingle;
            txtLog.Font = new Font("Consolas", 8.25f);
            txtLog.Location = new Point(16, 62);
            txtLog.Size = new Size(544, 156);
            pnlRun.Controls.Add(txtLog);

            btnCopyLog = NewButton("Logu kopyala", 16, 226, 130, 30, 0);
            btnCopyLog.Visible = false;
            btnCopyLog.Click += delegate { try { Clipboard.SetText(txtLog.Text); } catch { } };
            pnlRun.Controls.Add(btnCopyLog);

            btnRetry = NewButton("Tekrar dene", 154, 226, 130, 30, 0);
            btnRetry.Visible = false;
            btnRetry.Click += delegate
            {
                pnlRun.Visible = false;
                pnlSetup.Visible = true;
                lblStatus.ForeColor = Theme.Text;
                lblStatus.Text = "Hazırlanıyor...";
                btnStart.Enabled = true;
                btnRetry.Visible = false;
                btnCopyLog.Visible = false;
                installRunning = false;
            };
            pnlRun.Controls.Add(btnRetry);

            // ---------- Bitti paneli ----------
            pnlDone.Controls.Add(NewLabel("Kurulum tamamlandı.", 11f, Theme.Ok, true, 16, 10, 300, 24));

            browsers = Browsers.Detect();
            cboBrowsers = new ComboBox();
            cboBrowsers.DropDownStyle = ComboBoxStyle.DropDownList;
            cboBrowsers.Location = new Point(16, 44);
            cboBrowsers.Size = new Size(200, 24);
            foreach (BrowserInfo b in browsers) cboBrowsers.Items.Add(b);
            if (cboBrowsers.Items.Count > 0) cboBrowsers.SelectedIndex = 0;
            cboBrowsers.Enabled = cboBrowsers.Items.Count > 0;
            pnlDone.Controls.Add(cboBrowsers);

            Button btnOpen = NewButton("Uzantılar sayfasını aç", 224, 42, 200, 30, 1);
            btnOpen.Enabled = cboBrowsers.Items.Count > 0;
            btnOpen.Click += delegate { OpenExtensions(); };
            pnlDone.Controls.Add(btnOpen);

            pnlDone.Controls.Add(NewLabel(
                "Son adım — eklentiyi tarayıcıya yükle (tek seferlik):\r\n" +
                "1)  Yukarıdaki düğmeyle Uzantılar sayfasını açın\r\n" +
                "2)  Sağ üstten \"Geliştirici modu\"nu açın\r\n" +
                "3)  \"Paketlenmemiş öğe yükle\" → pencerenin adres çubuğuna aşağıdaki yolu\r\n" +
                "     yapıştırıp Enter deyin (yol panoda hazır):",
                9f, Theme.Text, false, 16, 84, 545, 92));

            pnlDone.Controls.Add(NewLabel("Eklenti klasörü:", 8.5f, Theme.Muted, false, 16, 182, 90, 18));
            txtPath = new TextBox();
            txtPath.ReadOnly = true;
            txtPath.BorderStyle = BorderStyle.FixedSingle;
            txtPath.BackColor = Theme.Surface2;
            txtPath.ForeColor = Theme.Text;
            txtPath.Font = new Font("Consolas", 8.25f);
            txtPath.Location = new Point(112, 178);
            txtPath.Size = new Size(448, 24);
            txtPath.Text = Core.ExtDir();
            pnlDone.Controls.Add(txtPath);

            Button btnCopyPath = NewButton("Yolu kopyala", 16, 210, 120, 30, 0);
            btnCopyPath.Click += delegate { try { Clipboard.SetText(Core.ExtDir()); } catch { } };
            pnlDone.Controls.Add(btnCopyPath);

            Button btnFolder = NewButton("Klasörü aç", 144, 210, 120, 30, 0);
            btnFolder.Click += delegate
            {
                try { Process.Start("explorer.exe", Core.ExtDir()); } catch { }
            };
            pnlDone.Controls.Add(btnFolder);

            btnFinish = NewButton("Bitir", 452, 210, 108, 30, 1);
            btnFinish.Click += delegate { Close(); };
            pnlDone.Controls.Add(btnFinish);
        }

        private void StartInstall()
        {
            installRunning = true;
            btnStart.Enabled = false;
            pnlSetup.Visible = false;
            pnlDone.Visible = false;
            pnlRun.Visible = true;
            btnCopyLog.Visible = false;
            btnRetry.Visible = false;
            string vdhArgs = chkFfmpeg.Checked ? "sessiz" : "sessiz noffmpeg";
            ThreadPool.QueueUserWorkItem(delegate(object state) { RunJob(vdhArgs); });
        }

        private void RunJob(string vdhArgs)
        {
            try
            {
                Core.KillHelper();
                string ps1 = Core.WriteTempScript("FoxKur.ps1");
                int code = Core.RunPowerShell(ps1, vdhArgs, delegate(string line) { OnLine(line); });
                if (code == 0) code = Core.ExtractExtension();
                if (code == 0) Done();
                else Failed(code);
            }
            catch (Exception ex)
            {
                OnLine("HATA: " + ex.Message);
                Failed(-1);
            }
        }

        private void Done()
        {
            try
            {
                BeginInvoke(new MethodInvoker(delegate
                {
                    installRunning = false;
                    pnlRun.Visible = false;
                    pnlDone.Visible = true;
                    try { Clipboard.SetText(Core.ExtDir()); } catch { }
                    OpenExtensions();
                }));
            }
            catch { }
        }

        private void Failed(int code)
        {
            try
            {
                BeginInvoke(new MethodInvoker(delegate
                {
                    installRunning = false;
                    lblStatus.Text = "Kurulum başarısız (kod " + code + "). Logu inceleyip tekrar deneyin.";
                    lblStatus.ForeColor = Theme.Err;
                    btnCopyLog.Visible = true;
                    btnRetry.Visible = true;
                }));
            }
            catch { }
        }

        private void OnLine(string line)
        {
            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action<string>(OnLine), line);
                    return;
                }
                string trimmed = (line ?? "").Trim();
                if (trimmed.Length > 0)
                {
                    lblStatus.Text = trimmed.Length > 90 ? trimmed.Substring(0, 90) + "..." : trimmed;
                }
                txtLog.AppendText(line + "\r\n");
                txtLog.SelectionStart = txtLog.TextLength;
                txtLog.ScrollToCaret();
            }
            catch { }
        }

        private void OpenExtensions()
        {
            if (InvokeRequired)
            {
                BeginInvoke(new MethodInvoker(OpenExtensions));
                return;
            }
            BrowserInfo b = cboBrowsers.SelectedItem as BrowserInfo;
            if (b == null) return;
            Browsers.OpenExtensionsPage(b, this);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (installRunning)
            {
                DialogResult r = MessageBox.Show(this, "Kurulum sürüyor. Yine de kapatılsın mı?",
                    "FoxDownloader", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (r != DialogResult.Yes)
                {
                    e.Cancel = true;
                    return;
                }
            }
            base.OnFormClosing(e);
        }
    }
}
