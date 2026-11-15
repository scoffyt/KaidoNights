// =====================================================================
//  Janela do jogo: WebView2 sem nenhuma interface de navegador.
//  Separado do Program para que as DLLs do WebView2 so sejam carregadas
//  depois da atualizacao (elas podem ter sido substituidas).
// =====================================================================
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class GameHost
{
    public static int Run()
    {
        string ver = null;
        try { ver = CoreWebView2Environment.GetAvailableBrowserVersionString(); } catch { }
        if (string.IsNullOrEmpty(ver))
        {
            DialogResult r = MessageBox.Show(
                "O componente Microsoft Edge WebView2 nao esta instalado neste computador.\n\n" +
                "Sim: abrir a pagina de download da Microsoft (gratuito, instala em 1 minuto).\n" +
                "Nao: jogar agora no navegador.",
                "Kaido Nights", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);
            if (r == DialogResult.Yes) Process.Start("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            else if (r == DialogResult.No)
            {
                string vbs = Path.Combine(Program.InstallDir, "launcher", "KaidoNights.vbs");
                if (File.Exists(vbs)) Process.Start("wscript.exe", "\"" + vbs + "\"");
            }
            return 1;
        }
        Application.Run(new GameForm());
        return 0;
    }
}

class GameForm : Form
{
    readonly WebView2 web;
    bool fullscreen;
    FormWindowState prevState = FormWindowState.Maximized;
    readonly string stateFile;

    public GameForm()
    {
        Text = "Kaido Nights";
        BackColor = Color.Black;
        Width = 1600; Height = 900;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(960, 540);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        stateFile = Path.Combine(Program.DataDir, "window.txt");
        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.Black;
        Controls.Add(web);
        bool startFull = !Program.Windowed;
        try { if (File.Exists(stateFile)) startFull = !Program.Windowed && File.ReadAllText(stateFile).Trim() != "windowed"; } catch { }
        WindowState = FormWindowState.Maximized;
        if (startFull) SetFullscreen(true);
        Load += async delegate { await InitWeb(); };
        FormClosing += delegate { try { File.WriteAllText(stateFile, fullscreen ? "fullscreen" : "windowed"); } catch { } };
    }

    async Task InitWeb()
    {
        try
        {
            CoreWebView2EnvironmentOptions opts = new CoreWebView2EnvironmentOptions();
            opts.AdditionalBrowserArguments = "--autoplay-policy=no-user-gesture-required --disable-features=Translate --enable-gpu-rasterization --ignore-gpu-blocklist";
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDir, "webview"), opts);
            await web.EnsureCoreWebView2Async(env);
            CoreWebView2 core = web.CoreWebView2;
            CoreWebView2Settings s = core.Settings;
            s.AreDefaultContextMenusEnabled = Program.Dev;
            s.AreDevToolsEnabled = Program.Dev;
            s.AreBrowserAcceleratorKeysEnabled = Program.Dev;
            s.IsStatusBarEnabled = false;
            s.IsZoomControlEnabled = false;
            s.IsBuiltInErrorPageEnabled = true;
            core.SetVirtualHostNameToFolderMapping("kaido.game", Program.InstallDir, CoreWebView2HostResourceAccessKind.Allow);
            // F11 / Alt+Enter toggle fullscreen even while the game has focus
            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                "window.__kaidoNative = true;" +
                "window.addEventListener('keydown', function (e) {" +
                "  if (e.key === 'F11' || (e.key === 'Enter' && e.altKey)) { e.preventDefault(); e.stopPropagation(); window.chrome.webview.postMessage('fullscreen'); }" +
                "}, true);");
            core.WebMessageReceived += delegate (object sender, CoreWebView2WebMessageReceivedEventArgs e)
            {
                string m = null; try { m = e.TryGetWebMessageAsString(); } catch { }
                if (m == "fullscreen") SetFullscreen(!fullscreen);
                else if (m == "quit") Close();
            };
            core.ContainsFullScreenElementChanged += delegate { SetFullscreen(core.ContainsFullScreenElement || fullscreen); };
            core.NewWindowRequested += delegate (object sender, CoreWebView2NewWindowRequestedEventArgs e)
            {
                e.Handled = true;
                try { if (e.Uri.StartsWith("http")) Process.Start(e.Uri); } catch { }
            };
            core.ProcessFailed += delegate (object sender, CoreWebView2ProcessFailedEventArgs e)
            {
                Program.Log("webview process failed: " + e.ProcessFailedKind);
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) { MessageBox.Show("O jogo parou de responder e sera reiniciado.", "Kaido Nights"); Application.Restart(); }
                else BeginInvoke((MethodInvoker)delegate { try { core.Reload(); } catch { } });
            };
            core.Navigate("http://kaido.game/index.html");
        }
        catch (Exception e)
        {
            Program.Log("webview init failed: " + e);
            MessageBox.Show("Nao foi possivel iniciar o jogo:\n\n" + e.Message, "Kaido Nights", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    void SetFullscreen(bool on)
    {
        if (on == fullscreen) return;
        fullscreen = on;
        if (on)
        {
            prevState = WindowState == FormWindowState.Minimized ? FormWindowState.Maximized : WindowState;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;   // re-apply so the taskbar is covered
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = prevState;
        }
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == Keys.F11 || keyData == (Keys.Enter | Keys.Alt)) { SetFullscreen(!fullscreen); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }
}
