# =====================================================================
#  Compila o aplicativo nativo KaidoNights.exe (WebView2) em dist\native\
#  Usa o csc.exe do .NET Framework (vem no Windows) e baixa o pacote
#  oficial Microsoft.Web.WebView2 do nuget.org (fica em cache em tools\.cache).
# =====================================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'dist\native'
$cache = Join-Path $PSScriptRoot '.cache'
New-Item -ItemType Directory -Path $out, $cache -Force | Out-Null
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

# ---- WebView2 SDK (latest stable)
$pkgDir = Get-ChildItem $cache -Directory -Filter 'webview2-*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $pkgDir) {
  Write-Host 'Baixando Microsoft.Web.WebView2 (nuget.org)...'
  $idx = Invoke-RestMethod 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json'
  $ver = @($idx.versions | Where-Object { $_ -notmatch '-' })[-1]
  $nupkg = Join-Path $cache ('webview2-' + $ver + '.zip')
  Invoke-WebRequest ('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/' + $ver + '/microsoft.web.webview2.' + $ver + '.nupkg') -OutFile $nupkg -UseBasicParsing
  $dest = Join-Path $cache ('webview2-' + $ver)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($nupkg, $dest)
  Remove-Item $nupkg -Force
  $pkgDir = Get-Item $dest
}
Write-Host ('WebView2 SDK: ' + $pkgDir.Name)
$libDir = @('lib\net462', 'lib\net45') | ForEach-Object { Join-Path $pkgDir.FullName $_ } | Where-Object { Test-Path (Join-Path $_ 'Microsoft.Web.WebView2.WinForms.dll') } | Select-Object -First 1
if (-not $libDir) { throw 'Microsoft.Web.WebView2.WinForms.dll nao encontrado no pacote.' }
$loader = Join-Path $pkgDir.FullName 'runtimes\win-x64\native\WebView2Loader.dll'
if (-not (Test-Path $loader)) { throw 'WebView2Loader.dll (x64) nao encontrado no pacote.' }

# ---- compile
$fw = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$csc = Join-Path $fw 'csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe' }
$exe = Join-Path $out 'KaidoNights.exe'
$cscArgs = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', ('/out:' + $exe),
  ('/win32icon:' + (Join-Path $root 'launcher\kaido.ico')), ('/win32manifest:' + (Join-Path $root 'native\app.manifest')),
  '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
  ('/reference:' + (Join-Path $fw 'System.Web.Extensions.dll')),
  ('/reference:' + (Join-Path $libDir 'Microsoft.Web.WebView2.Core.dll')), ('/reference:' + (Join-Path $libDir 'Microsoft.Web.WebView2.WinForms.dll')),
  (Join-Path $root 'native\KaidoNights.cs'), (Join-Path $root 'native\GameHost.cs'))
Write-Host 'Compilando KaidoNights.exe...'
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$msg = & $csc $cscArgs 2>&1
$code = $LASTEXITCODE
$ErrorActionPreference = $prev
$msg | ForEach-Object { Write-Host $_ }
if ($code -ne 0 -or -not (Test-Path $exe)) { throw 'Falha ao compilar KaidoNights.exe' }
Copy-Item (Join-Path $libDir 'Microsoft.Web.WebView2.Core.dll'), (Join-Path $libDir 'Microsoft.Web.WebView2.WinForms.dll'), $loader -Destination $out -Force
Get-ChildItem $out | ForEach-Object { Write-Host ('  ' + $_.Name + '  ' + [math]::Round($_.Length / 1KB) + ' KB') }
Write-Host 'Aplicativo nativo pronto em dist\native\' -ForegroundColor Green
