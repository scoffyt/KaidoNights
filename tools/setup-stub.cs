// Kaido Nights - instalador auto-extraivel.
// Compilado pelo tools\build-setup.ps1 com o csc.exe do .NET Framework (vem no Windows).
// Layout do .exe final:  [este programa][pacote .zip][tamanho do zip: 8 bytes][assinatura "KAIDOSFX": 8 bytes]
// Ao abrir: extrai o pacote para %TEMP%, executa Instalar.ps1 e limpa a pasta temporaria.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("Kaido Nights - Instalador")]
[assembly: AssemblyProduct("Kaido Nights")]
[assembly: AssemblyDescription("Instalador do jogo Kaido Nights")]
[assembly: AssemblyVersion("1.0.0.0")]

static class KaidoSetup
{
    const string Magic = "KAIDOSFX";

    [STAThread]
    static int Main(string[] args)
    {
        string tmp = Path.Combine(Path.GetTempPath(), "kaido-setup-" + Guid.NewGuid().ToString("N"));
        Form splash = null;
        try
        {
            Application.EnableVisualStyles();
            splash = Splash();
            string self = Assembly.GetExecutingAssembly().Location;
            string pkg = Path.Combine(tmp, "pkg");
            using (FileStream fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (fs.Length < 16) throw new Exception("O instalador esta corrompido.");
                fs.Seek(-16, SeekOrigin.End);
                byte[] tail = new byte[16];
                ReadFull(fs, tail, 16);
                if (Encoding.ASCII.GetString(tail, 8, 8) != Magic) throw new Exception("O instalador esta corrompido (pacote nao encontrado). Baixe-o novamente.");
                long len = BitConverter.ToInt64(tail, 0);
                long start = fs.Length - 16 - len;
                if (len <= 0 || start <= 0) throw new Exception("O instalador esta corrompido (tamanho invalido).");
                Directory.CreateDirectory(tmp);
                string zip = Path.Combine(tmp, "payload.zip");
                fs.Seek(start, SeekOrigin.Begin);
                using (FileStream outp = File.Create(zip))
                {
                    byte[] buf = new byte[1 << 20];
                    long left = len;
                    while (left > 0)
                    {
                        int n = fs.Read(buf, 0, (int)Math.Min(buf.Length, left));
                        if (n <= 0) throw new Exception("O instalador esta incompleto. Baixe-o novamente.");
                        outp.Write(buf, 0, n);
                        left -= n;
                        Application.DoEvents();
                    }
                }
                ZipFile.ExtractToDirectory(zip, pkg);
                File.Delete(zip);
            }
            string script = Path.Combine(pkg, "Instalar.ps1");
            if (!File.Exists(script)) throw new Exception("Instalar.ps1 nao encontrado no pacote.");
            string extra = "";
            foreach (string a in args) { if (a.Equals("/quiet", StringComparison.OrdinalIgnoreCase) || a.Equals("/s", StringComparison.OrdinalIgnoreCase)) extra = " -Quiet"; }
            ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
                "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\"" + extra);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WorkingDirectory = pkg;
            splash.Close(); splash = null;
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception e)
        {
            if (splash != null) { splash.Close(); splash = null; }
            MessageBox.Show("Nao foi possivel instalar o Kaido Nights:\n\n" + e.Message, "Kaido Nights", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { }
        }
    }

    static void ReadFull(Stream s, byte[] buf, int count)
    {
        int off = 0;
        while (off < count)
        {
            int n = s.Read(buf, off, count - off);
            if (n <= 0) throw new Exception("Leitura incompleta do instalador.");
            off += n;
        }
    }

    static Form Splash()
    {
        Form f = new Form();
        f.Text = "Kaido Nights";
        f.FormBorderStyle = FormBorderStyle.FixedDialog;
        f.MaximizeBox = false; f.MinimizeBox = false;
        f.StartPosition = FormStartPosition.CenterScreen;
        f.Width = 420; f.Height = 150;
        f.BackColor = Color.FromArgb(10, 52, 52);
        f.ForeColor = Color.White;
        try { f.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch { }
        Label t = new Label();
        t.Text = "KAIDO NIGHTS";
        t.Font = new Font("Segoe UI", 16, FontStyle.Bold);
        t.ForeColor = Color.FromArgb(204, 255, 0);
        t.AutoSize = true; t.Left = 20; t.Top = 14;
        Label l = new Label();
        l.Text = "Preparando o instalador...";
        l.Font = new Font("Segoe UI", 10);
        l.AutoSize = true; l.Left = 22; l.Top = 60;
        f.Controls.Add(t); f.Controls.Add(l);
        f.Show();
        Application.DoEvents();
        return f;
    }
}
