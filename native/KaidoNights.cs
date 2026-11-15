// =====================================================================
//  KAIDO NIGHTS - aplicativo nativo do Windows
//  - janela propria (icone, titulo, tela cheia F11 / Alt+Enter), sem barra de endereco
//  - o jogo roda no componente WebView2 do Windows, servido direto da pasta instalada
//    em http://kaido.game/ (mapeamento de pasta, sem servidor local)
//  - antes de abrir: verifica e aplica atualizacoes (manifesto assinado + SHA-256),
//    inclusive deste proprio .exe (reinicia sozinho)
//  Argumentos: --repair  --no-update  --windowed  --dev (habilita F12/menus)
//  Compilado por tools/build-native.ps1 (C# 5, .NET Framework 4.8 + Microsoft.Web.WebView2)
// =====================================================================
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Kaido Nights")]
[assembly: AssemblyProduct("Kaido Nights")]
[assembly: AssemblyDescription("Kaido Nights - jogo de drift")]
[assembly: AssemblyCompany("Kaido Nights")]
[assembly: AssemblyVersion("1.0.0.0")]

static class Program
{
    public static string InstallDir;
    public static string DataDir;
    public static bool Dev, Windowed, Repair, NoUpdate;

    [STAThread]
    static int Main(string[] args)
    {
        foreach (string a in args)
        {
            string x = a.ToLowerInvariant();
            if (x == "--dev") Dev = true;
            else if (x == "--windowed") Windowed = true;
            else if (x == "--repair" || x == "repair") Repair = true;
            else if (x == "--no-update") NoUpdate = true;
        }
        InstallDir = Path.GetDirectoryName(Application.ExecutablePath);
        DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KaidoNights");
        Directory.CreateDirectory(DataDir);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        CleanupOldFiles();

        // ---- update (splash window)
        bool restart = false;
        if (!NoUpdate)
        {
            SplashForm splash = new SplashForm();
            Updater up = new Updater(InstallDir, DataDir, Repair);
            up.Progress += delegate (string text, int pct) { splash.SetStatus(text, pct); };
            splash.Shown += delegate
            {
                Thread t = new Thread(delegate ()
                {
                    try { up.Run(); }
                    catch (Exception e) { Log("atualizacao nao concluida: " + e.Message); up.Report("Nao foi possivel atualizar agora - abrindo a versao instalada.", 100); Thread.Sleep(1500); }
                    splash.BeginInvoke((MethodInvoker)delegate { splash.Close(); });
                });
                t.IsBackground = true;
                t.Start();
            };
            Application.Run(splash);
            restart = up.RestartRequired;
        }
        if (restart)
        {
            // the executable or its libraries were updated: start the new version
            Process.Start(Application.ExecutablePath, "--no-update" + (Windowed ? " --windowed" : "") + (Dev ? " --dev" : ""));
            return 0;
        }
        // ---- game window (WebView2 lives in GameHost so its assemblies load only now)
        return GameHost.Run();
    }

    static void CleanupOldFiles()
    {
        try { foreach (string f in Directory.GetFiles(InstallDir, "*.old")) { try { File.Delete(f); } catch { } } } catch { }
    }

    public static void Log(string msg)
    {
        try { File.AppendAllText(Path.Combine(DataDir, "launcher.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  [app] " + msg + "\r\n", Encoding.UTF8); } catch { }
    }
}

// ---------------------------------------------------------------------
//  splash / progress window
// ---------------------------------------------------------------------
class SplashForm : Form
{
    Label status, notes;
    ProgressBar bar;
    public SplashForm()
    {
        Text = "Kaido Nights";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Width = 560; Height = 220;
        BackColor = Color.FromArgb(10, 52, 52);
        ForeColor = Color.White;
        ShowInTaskbar = true;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        Label t = new Label();
        t.Text = "KAIDO NIGHTS"; t.Font = new Font("Segoe UI", 24, FontStyle.Bold); t.ForeColor = Color.FromArgb(204, 255, 0);
        t.AutoSize = true; t.Left = 26; t.Top = 22;
        Panel stripe = new Panel(); stripe.BackColor = Color.FromArgb(255, 26, 160); stripe.Left = 30; stripe.Top = 72; stripe.Width = 120; stripe.Height = 4;
        status = new Label(); status.Font = new Font("Segoe UI", 10); status.Left = 28; status.Top = 96; status.Width = 500; status.Height = 22; status.Text = "Iniciando...";
        bar = new ProgressBar(); bar.Left = 30; bar.Top = 124; bar.Width = 498; bar.Height = 14; bar.Minimum = 0; bar.Maximum = 100;
        notes = new Label(); notes.Font = new Font("Segoe UI", 9); notes.Left = 28; notes.Top = 148; notes.Width = 500; notes.Height = 56; notes.ForeColor = Color.FromArgb(180, 220, 220);
        Controls.Add(t); Controls.Add(stripe); Controls.Add(status); Controls.Add(bar); Controls.Add(notes);
    }
    public void SetStatus(string text, int pct)
    {
        if (IsDisposed) return;
        if (InvokeRequired) { try { BeginInvoke((MethodInvoker)delegate { SetStatus(text, pct); }); } catch { } return; }
        if (text != null && text.StartsWith("#notes:")) { notes.Text = text.Substring(7); return; }
        if (text != null) status.Text = text;
        if (pct >= 0) bar.Value = Math.Max(0, Math.Min(100, pct));
    }
}

// ---------------------------------------------------------------------
//  updater (same channel format as launcher/KaidoCommon.ps1)
// ---------------------------------------------------------------------
class Updater
{
    public delegate void ProgressHandler(string text, int pct);
    public event ProgressHandler Progress;
    public bool RestartRequired;
    readonly string install, data;
    readonly bool repair;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();

    public Updater(string installDir, string dataDir, bool repairMode)
    {
        install = installDir; data = dataDir; repair = repairMode;
        json.MaxJsonLength = int.MaxValue;
        try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }
    }
    public void Report(string t, int p) { if (Progress != null) Progress(t, p); }

    static bool IsRemote(string u) { return u.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || u.StartsWith("https://", StringComparison.OrdinalIgnoreCase); }

    byte[] GetBytes(string src)
    {
        if (!IsRemote(src)) return File.ReadAllBytes(src);
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(src + (src.Contains("?") ? "&" : "?") + "t=" + DateTime.UtcNow.Ticks);
        req.UserAgent = "KaidoNights/1"; req.Timeout = 8000; req.ReadWriteTimeout = 15000;
        req.Headers.Add("Cache-Control", "no-cache");
        using (WebResponse resp = req.GetResponse())
        using (Stream s = resp.GetResponseStream())
        using (MemoryStream ms = new MemoryStream()) { s.CopyTo(ms); return ms.ToArray(); }
    }

    static string Sha256File(string path)
    {
        using (SHA256 sha = SHA256.Create())
        using (FileStream fs = File.OpenRead(path)) return Hex(sha.ComputeHash(fs));
    }
    static string Hex(byte[] b) { StringBuilder sb = new StringBuilder(b.Length * 2); foreach (byte x in b) sb.Append(x.ToString("x2")); return sb.ToString(); }

    static int CompareVersion(string a, string b)
    {
        string[] x = a.Split('.'), y = b.Split('.');
        for (int i = 0; i < 3; i++)
        {
            int xi = i < x.Length ? int.Parse(x[i]) : 0, yi = i < y.Length ? int.Parse(y[i]) : 0;
            if (xi != yi) return xi - yi;
        }
        return 0;
    }

    public void Run()
    {
        string cfgFile = Path.Combine(install, "launcher", "update.json");
        string keyFile = Path.Combine(install, "launcher", "update-key.xml");
        if (!File.Exists(cfgFile) || !File.Exists(keyFile)) { Report("Pronto", 100); return; }
        Dictionary<string, object> cfg = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(cfgFile, Encoding.UTF8));
        List<string> urls = new List<string>();
        if (cfg.ContainsKey("manifestUrls") && cfg["manifestUrls"] is ArrayList) foreach (object o in (ArrayList)cfg["manifestUrls"]) urls.Add(Convert.ToString(o));
        if (urls.Count == 0) { Report("Pronto", 100); return; }
        string keyXml = File.ReadAllText(keyFile);

        Report("Procurando atualizacoes...", 3);
        byte[] manBytes = null; string usedUrl = null; string errors = "";
        foreach (string u in urls)
        {
            try
            {
                byte[] b = GetBytes(u);
                string sig = Encoding.ASCII.GetString(GetBytes(u + ".sig")).Trim();
                using (RSACryptoServiceProvider rsa = new RSACryptoServiceProvider())
                {
                    rsa.FromXmlString(keyXml);
                    if (!rsa.VerifyData(b, new SHA256CryptoServiceProvider(), Convert.FromBase64String(sig))) throw new Exception("assinatura invalida");
                }
                manBytes = b; usedUrl = u; break;
            }
            catch (Exception e) { errors += u + ": " + e.Message + " | "; Program.Log("manifesto falhou " + u + " - " + e.Message); }
        }
        if (manBytes == null) throw new Exception("Nenhum servidor de atualizacao respondeu. " + errors);

        Dictionary<string, object> remote = json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(manBytes));
        if (Convert.ToString(remote["app"]) != "kaido-nights") throw new Exception("manifesto de outro aplicativo");
        string remoteVer = Convert.ToString(remote["version"]);
        string localManFile = Path.Combine(install, ".kaido", "manifest.json");
        Dictionary<string, string> localIdx = new Dictionary<string, string>();
        string localVer = "0.0.0";
        List<string> localPaths = new List<string>();
        if (File.Exists(localManFile))
        {
            try
            {
                Dictionary<string, object> lm = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(localManFile, Encoding.UTF8));
                localVer = Convert.ToString(lm["version"]);
                foreach (object o in (ArrayList)lm["files"]) { Dictionary<string, object> f = (Dictionary<string, object>)o; localIdx[Convert.ToString(f["p"])] = Convert.ToString(f["h"]); localPaths.Add(Convert.ToString(f["p"])); }
            }
            catch { }
        }
        bool newer = CompareVersion(remoteVer, localVer) > 0;
        if (!newer && !repair) { Report("Versao " + localVer + " (atualizada)", 100); Thread.Sleep(250); return; }
        if (newer)
        {
            Report("Atualizando " + localVer + " -> " + remoteVer, 6);
            if (remote.ContainsKey("notes") && remote["notes"] != null && Convert.ToString(remote["notes"]) != "") Report("#notes:Novidades: " + Convert.ToString(remote["notes"]), -1);
        }
        else Report("Verificando a instalacao...", 5);

        string fileBase = remote.ContainsKey("fileBase") && remote["fileBase"] != null ? Convert.ToString(remote["fileBase"]) : null;
        string baseUrl = IsRemote(usedUrl) ? usedUrl.Substring(0, usedUrl.LastIndexOf('/')) : Path.GetDirectoryName(usedUrl);

        // 1. what is missing or different
        ArrayList files = (ArrayList)remote["files"];
        List<Dictionary<string, object>> need = new List<Dictionary<string, object>>();
        HashSet<string> remotePaths = new HashSet<string>();
        int i = 0;
        foreach (object o in files)
        {
            i++;
            Dictionary<string, object> f = (Dictionary<string, object>)o;
            string p = Convert.ToString(f["p"]), h = Convert.ToString(f["h"]);
            long s = Convert.ToInt64(f["s"]);
            remotePaths.Add(p);
            string dest = Path.Combine(install, p.Replace('/', '\\'));
            bool ok = false;
            if (File.Exists(dest))
            {
                if (repair) { if (i % 20 == 0) Report("Verificando arquivos " + i + "/" + files.Count, 10 * i / files.Count); ok = Sha256File(dest) == h; }
                else ok = localIdx.ContainsKey(p) && localIdx[p] == h && new FileInfo(dest).Length == s;
            }
            if (!ok) need.Add(f);
        }
        List<string> removed = new List<string>();
        foreach (string p in localPaths) if (!remotePaths.Contains(p)) removed.Add(p);

        // 2. download to staging, verified, nothing replaced yet
        string staging = Path.Combine(data, "staging");
        Directory.CreateDirectory(staging);
        long total = 0, done = 0; foreach (Dictionary<string, object> f in need) total += Convert.ToInt64(f["s"]);
        int k = 0; DateTime last = DateTime.MinValue;
        foreach (Dictionary<string, object> f in need)
        {
            k++;
            string p = Convert.ToString(f["p"]), h = Convert.ToString(f["h"]);
            long s = Convert.ToInt64(f["s"]);
            string tmp = Path.Combine(staging, h);
            if (File.Exists(tmp) && Sha256File(tmp) == h) { done += s; continue; }
            string src;
            if (f.ContainsKey("u") && f["u"] != null) src = Convert.ToString(f["u"]);
            else if (fileBase != null) { string[] seg = p.Split('/'); for (int j = 0; j < seg.Length; j++) seg[j] = Uri.EscapeDataString(seg[j]); src = fileBase.TrimEnd('/') + "/" + string.Join("/", seg); }
            else src = IsRemote(baseUrl) ? baseUrl + "/objects/" + h : Path.Combine(baseUrl, "objects", h);
            for (int tries = 1; ; tries++)
            {
                long before = done;
                try
                {
                    using (Stream input = IsRemote(src) ? OpenRemote(src) : File.OpenRead(src))
                    using (FileStream output = File.Create(tmp))
                    {
                        byte[] buf = new byte[262144]; int n;
                        while ((n = input.Read(buf, 0, buf.Length)) > 0)
                        {
                            output.Write(buf, 0, n); done += n;
                            if ((DateTime.Now - last).TotalMilliseconds > 120)
                            {
                                last = DateTime.Now;
                                Report("Baixando " + k + "/" + need.Count + "  (" + (done / 1048576.0).ToString("0.0") + " / " + (total / 1048576.0).ToString("0.0") + " MB)", 10 + (int)(85 * done / Math.Max(1, total)));
                            }
                        }
                    }
                    if (Sha256File(tmp) != h) throw new Exception("arquivo corrompido: " + p);
                    break;
                }
                catch (Exception e)
                {
                    done = before;
                    try { File.Delete(tmp); } catch { }
                    Program.Log("falha baixando " + p + " (tentativa " + tries + "): " + e.Message);
                    if (tries >= 3) throw new Exception("Falha ao baixar " + p + ": " + e.Message);
                    Thread.Sleep(2000);
                }
            }
        }

        // 3. apply with backup and rollback
        Report("Instalando arquivos...", 96);
        string backup = Path.Combine(data, "backup", DateTime.Now.ToString("yyyyMMdd-HHmmss"));
        List<string[]> applied = new List<string[]>(); // dest, backupPath or "", rel
        try
        {
            foreach (Dictionary<string, object> f in need)
            {
                string p = Convert.ToString(f["p"]), h = Convert.ToString(f["h"]);
                string dest = Path.Combine(install, p.Replace('/', '\\'));
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                string bk = "";
                if (File.Exists(dest))
                {
                    bk = Path.Combine(backup, p.Replace('/', '\\'));
                    Directory.CreateDirectory(Path.GetDirectoryName(bk));
                    File.Copy(dest, bk, true);
                }
                string staged = Path.Combine(staging, h);
                try { File.Copy(staged, dest, true); }
                catch (IOException)
                {
                    // file in use (this exe or its libraries): move it aside, then copy
                    string old = dest + ".old";
                    try { if (File.Exists(old)) File.Delete(old); } catch { old = dest + "." + DateTime.Now.Ticks + ".old"; }
                    File.Move(dest, old);
                    File.Copy(staged, dest, true);
                }
                catch (UnauthorizedAccessException)
                {
                    string old = dest + "." + DateTime.Now.Ticks + ".old";
                    File.Move(dest, old);
                    File.Copy(staged, dest, true);
                }
                string ext = Path.GetExtension(dest).ToLowerInvariant();
                if ((ext == ".exe" || ext == ".dll") && string.Equals(Path.GetDirectoryName(dest), install, StringComparison.OrdinalIgnoreCase)) RestartRequired = true;
                applied.Add(new string[] { dest, bk, p });
            }
            foreach (string p in removed)
            {
                string dest = Path.Combine(install, p.Replace('/', '\\'));
                if (!File.Exists(dest)) continue;
                string bk = Path.Combine(backup, p.Replace('/', '\\'));
                Directory.CreateDirectory(Path.GetDirectoryName(bk));
                File.Copy(dest, bk, true);
                try { File.Delete(dest); } catch { }
                applied.Add(new string[] { dest, bk, p });
            }
            Directory.CreateDirectory(Path.Combine(install, ".kaido"));
            File.WriteAllBytes(localManFile, manBytes);
            string notes = remote.ContainsKey("notes") && remote["notes"] != null ? Convert.ToString(remote["notes"]) : "";
            Dictionary<string, object> v = new Dictionary<string, object>();
            v["version"] = remoteVer; v["released"] = remote.ContainsKey("released") ? remote["released"] : ""; v["notes"] = notes;
            File.WriteAllText(Path.Combine(install, "version.json"), json.Serialize(v), new UTF8Encoding(false));
        }
        catch (Exception e)
        {
            Program.Log("erro aplicando atualizacao, restaurando: " + e.Message);
            foreach (string[] a in applied)
            {
                try { if (a[1] != "" && File.Exists(a[1])) File.Copy(a[1], a[0], true); else if (a[1] == "") File.Delete(a[0]); } catch { }
            }
            RestartRequired = false;
            throw;
        }
        foreach (Dictionary<string, object> f in need) { try { File.Delete(Path.Combine(staging, Convert.ToString(f["h"]))); } catch { } }
        try
        {
            string bkRoot = Path.Combine(data, "backup");
            string[] dirs = Directory.GetDirectories(bkRoot); Array.Sort(dirs); Array.Reverse(dirs);
            for (int d = 2; d < dirs.Length; d++) { try { Directory.Delete(dirs[d], true); } catch { } }
        }
        catch { }
        Program.Log("atualizado para " + remoteVer + ": " + need.Count + " arquivos, " + removed.Count + " removidos");
        Report("Versao " + remoteVer + " pronta (" + need.Count + " arquivos atualizados)", 100);
        Thread.Sleep(500);
    }

    static Stream OpenRemote(string src)
    {
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(src);
        req.UserAgent = "KaidoNights/1"; req.Timeout = 30000; req.ReadWriteTimeout = 60000;
        WebResponse resp = req.GetResponse();
        return new ResponseStream(resp);
    }
    // closes the response together with the stream
    class ResponseStream : Stream
    {
        readonly WebResponse r; readonly Stream s;
        public ResponseStream(WebResponse resp) { r = resp; s = resp.GetResponseStream(); }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) { return s.Read(buffer, offset, count); }
        public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
        protected override void Dispose(bool disposing) { if (disposing) { s.Dispose(); r.Close(); } base.Dispose(disposing); }
    }
}
