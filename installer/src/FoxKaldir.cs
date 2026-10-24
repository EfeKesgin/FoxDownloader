// FoxDownloader - kaldirma arayuzu (FoxDownloader-Kaldir.exe).
// Yardimci servisi, tarayici kayitlarini ve eklenti klasorunu kaldirir.
// Sessiz kullanim:  FoxDownloader-Kaldir.exe /sessiz
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace FoxDownloader
{
    internal static class KaldirProgram
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
                string log = Core.TempLogPath("Kaldir");
                try { if (File.Exists(log)) File.Delete(log); } catch { }
                Core.Log("Kaldir", "FoxDownloader sessiz kaldirma basladi");
                int code = RemoveAll(delegate(string line) { Core.Log("Kaldir", line); });
                Core.Log("Kaldir", "Cikis kodu: " + code);
                Environment.Exit(code);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new KaldirForm());
        }

        // Tum kaldirma islerini sirayla yapar; cikis kodu doner.
        internal static int RemoveAll(Action<string> onLine)
        {
            try
            {
                Core.KillHelper();
                if (onLine != null) onLine("Yardimci servis durduruldu.");

                string ps1 = Core.WriteTempScript("FoxKaldir.ps1");
                int code = Core.RunPowerShell(ps1, "sessiz", onLine);

                // Eklenti klasoru (%LOCALAPPDATA%\FoxDownloader) - betik bilmez.
                try
                {
                    string dir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "FoxDownloader");
                    if (Directory.Exists(dir))
                    {
                        Directory.Delete(dir, true);
                        if (onLine != null) onLine("Eklenti klasoru silindi: " + dir);
                    }
                }
                catch (Exception ex)
                {
                    if (onLine != null) onLine("Eklenti klasoru silinemedi: " + ex.Message);
                }

                return code;
            }
            catch (Exception ex)
            {
                if (onLine != null) onLine("HATA: " + ex.Message);
                return 4;
            }
        }
    }

    internal sealed class KaldirForm : Form
    {
        private Panel pnlInfo;
        private Panel pnlRun;
        private Panel pnlDone;
        private Label lblStatus;
        private TextBox txtLog;
        private Button btnCopyLog;
        private ComboBox cboBrowsers;
        private bool running = false;

        public KaldirForm()
        {
            Text = "FoxDownloader Kaldırma";
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
            Controls.Add(NewLabel("FoxDownloader Kaldırma", 15f, Theme.Text, true, 22, 14, 420, 30));
            Controls.Add(NewLabel("Yardımcı servis, tarayıcı kayıtları ve eklenti klasörü kaldırılır.",
                9f, Theme.Muted, false, 24, 46, 520, 20));

            pnlInfo = NewPanel(22, 76, 576, 270);
            Controls.Add(pnlInfo);
            pnlRun = NewPanel(22, 76, 576, 270);
            pnlRun.Visible = false;
            Controls.Add(pnlRun);
            pnlDone = NewPanel(22, 76, 576, 270);
            pnlDone.Visible = false;
            Controls.Add(pnlDone);

            // ---------- Bilgi paneli ----------
            pnlInfo.Controls.Add(NewLabel("Kaldırılacaklar:", 9.5f, Theme.Text, true, 16, 14, 300, 20));
            pnlInfo.Controls.Add(NewLabel(
                "• Yardımcı servis: %LOCALAPPDATA%\\FoxDownloaderHelper\r\n" +
                "     (ythelper.exe, yt-dlp.exe, Deno, FFmpeg, manifest)\r\n" +
                "• Tarayıcı kayıtları: Chrome, Chromium, Brave, Edge, Vivaldi, Opera\r\n" +
                "• Eklenti klasörü: %LOCALAPPDATA%\\FoxDownloader\\Eklenti",
                9f, Theme.Muted, false, 16, 38, 545, 92));

            pnlInfo.Controls.Add(NewLabel(
                "Notlar:\r\n" +
                "• Tarayıcıyı kapatmanız önerilir.\r\n" +
                "• Eklentiyi tarayıcıdan ayrıca kaldırmayı unutmayın:\r\n" +
                "     Uzantılar sayfası → FoxDownloader → Kaldır",
                8.5f, Theme.Muted, false, 16, 140, 545, 70));

            Button btnRemove = NewButton("Kaldır", 16, 214, 150, 40, 2);
            btnRemove.Click += delegate { ConfirmRemove(); };
            pnlInfo.Controls.Add(btnRemove);

            Button btnCancel = NewButton("İptal", 178, 214, 110, 40, 0);
            btnCancel.Click += delegate { Close(); };
            pnlInfo.Controls.Add(btnCancel);

            // ---------- İlerleme paneli ----------
            lblStatus = NewLabel("Kaldırılıyor...", 9.5f, Theme.Text, true, 16, 12, 545, 20);
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

            // ---------- Bitti paneli ----------
            pnlDone.Controls.Add(NewLabel("Kaldırma tamamlandı.", 11f, Theme.Ok, true, 16, 10, 300, 24));
            pnlDone.Controls.Add(NewLabel(
                "Tarayıcıdan eklentiyi de kaldırın:\r\n" +
                "Uzantılar sayfası → FoxDownloader → Kaldır\r\n\r\n" +
                "İndirdiğiniz video dosyaları İndirilenler klasöründe kalır; " +
                "isterseniz elle silebilirsiniz.",
                9f, Theme.Text, false, 16, 44, 545, 96));

            List<BrowserInfo> browsers = Browsers.Detect();
            cboBrowsers = new ComboBox();
            cboBrowsers.DropDownStyle = ComboBoxStyle.DropDownList;
            cboBrowsers.Location = new Point(16, 150);
            cboBrowsers.Size = new Size(200, 24);
            foreach (BrowserInfo b in browsers) cboBrowsers.Items.Add(b);
            if (cboBrowsers.Items.Count > 0) cboBrowsers.SelectedIndex = 0;
            cboBrowsers.Enabled = cboBrowsers.Items.Count > 0;
            pnlDone.Controls.Add(cboBrowsers);

            Button btnOpen = NewButton("Uzantılar sayfasını aç", 224, 148, 200, 30, 1);
            btnOpen.Enabled = cboBrowsers.Items.Count > 0;
            btnOpen.Click += delegate { OpenExtensions(); };
            pnlDone.Controls.Add(btnOpen);

            Button btnFinish = NewButton("Bitir", 452, 210, 108, 30, 1);
            btnFinish.Click += delegate { Close(); };
            pnlDone.Controls.Add(btnFinish);
        }

        private void ConfirmRemove()
        {
            DialogResult r = MessageBox.Show(this,
                "Tüm FoxDownloader bileşenleri kaldırılacak. Emin misiniz?",
                "FoxDownloader", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (r != DialogResult.Yes) return;
            running = true;
            pnlInfo.Visible = false;
            pnlDone.Visible = false;
            pnlRun.Visible = true;
            ThreadPool.QueueUserWorkItem(delegate(object state)
            {
                int code = KaldirProgram.RemoveAll(delegate(string line) { OnLine(line); });
                try
                {
                    BeginInvoke(new MethodInvoker(delegate
                    {
                        running = false;
                        pnlRun.Visible = false;
                        pnlDone.Visible = true;
                        if (code != 0)
                        {
                            lblStatus.Text = "Kaldırma bazı adımlarda başarısız oldu (kod " + code + ").";
                        }
                    }));
                }
                catch { }
            });
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
            if (running)
            {
                DialogResult r = MessageBox.Show(this, "Kaldırma sürüyor. Yine de kapatılsın mı?",
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
