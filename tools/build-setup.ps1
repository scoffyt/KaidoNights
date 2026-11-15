# =====================================================================
#  Gera os instaladores .exe (sem programas extras: usa o compilador C#
#  do .NET Framework que ja vem no Windows):
#    dist\KaidoNights-Setup.exe           pequeno: baixa o jogo do servidor de atualizacao (update.json)
#    dist\KaidoNights-Setup-Completo.exe  offline: leva a versao atual inteira dentro do .exe
#  Antes: node tools\release.mjs   (publica a versao em release\)
# =====================================================================
param([switch]$OnlyWeb)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$rel = Join-Path $root 'release'
$L = Join-Path $root 'launcher'
if (-not (Test-Path (Join-Path $rel 'manifest.json'))) { throw 'release\manifest.json nao existe. Rode primeiro: node tools\release.mjs' }
if (-not (Test-Path (Join-Path $L 'update-key.xml'))) { throw 'launcher\update-key.xml nao existe. Rode primeiro: node tools\release.mjs' }
$m = Get-Content (Join-Path $rel 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$dist = Join-Path $root 'dist'; New-Item -ItemType Directory -Path $dist -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# ---- 1. compile the self-extracting stub
$fw = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$csc = Join-Path $fw 'csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe (.NET Framework 4) nao encontrado.' }
$work = Join-Path $env:TEMP ('kaido-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$stub = Join-Path $work 'stub.exe'
Write-Host 'Compilando o instalador...'
$cscArgs = @('/nologo', '/target:winexe', '/optimize+', ('/out:' + $stub), ('/win32icon:' + (Join-Path $L 'kaido.ico')),
  '/reference:System.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
  ('/reference:' + (Join-Path $fw 'System.IO.Compression.dll')), ('/reference:' + (Join-Path $fw 'System.IO.Compression.FileSystem.dll')),
  (Join-Path $PSScriptRoot 'setup-stub.cs'))
$out = & $csc $cscArgs 2>&1
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $stub)) { $out | ForEach-Object { Write-Host $_ }; throw 'Falha ao compilar o instalador (veja as mensagens acima).' }

# ---- 2. package = installer scripts (+ release for the offline setup) -> stub + zip + trailer
function Build([string]$name, [bool]$full) {
  $pkg = Join-Path $work ('pkg-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $pkg -Force | Out-Null
  foreach ($f in @('Instalar.ps1', 'KaidoCommon.ps1', 'update.json', 'update-key.xml', 'kaido.ico')) { Copy-Item -LiteralPath (Join-Path $L $f) -Destination $pkg }
  if ($full) {
    $r = Join-Path $pkg 'release'; New-Item -ItemType Directory -Path (Join-Path $r 'objects') -Force | Out-Null
    Copy-Item (Join-Path $rel 'manifest.json'), (Join-Path $rel 'manifest.json.sig') -Destination $r
    foreach ($f in $m.files) { $o = Join-Path $r ('objects\' + $f.h); if (-not (Test-Path $o)) { Copy-Item -LiteralPath (Join-Path $rel ('objects\' + $f.h)) -Destination $o } }
  }
  $zip = Join-Path $work ($name + '.zip')
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Write-Host ('Empacotando ' + $name + ' ...')
  [System.IO.Compression.ZipFile]::CreateFromDirectory($pkg, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  $target = Join-Path $dist $name
  $outS = [System.IO.File]::Create($target)
  try {
    $b = [System.IO.File]::ReadAllBytes($stub); $outS.Write($b, 0, $b.Length)
    $in = [System.IO.File]::OpenRead($zip)
    try { $in.CopyTo($outS) } finally { $in.Close() }
    $len = (Get-Item $zip).Length
    $lb = [BitConverter]::GetBytes([long]$len); $outS.Write($lb, 0, 8)
    $mg = [System.Text.Encoding]::ASCII.GetBytes('KAIDOSFX'); $outS.Write($mg, 0, 8)
  } finally { $outS.Close() }
  Remove-Item -LiteralPath $pkg -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
  Write-Host ('  ok: ' + $target + '  (' + [math]::Round((Get-Item $target).Length / 1MB, 1) + ' MB)') -ForegroundColor Green
}

try {
  Build 'KaidoNights-Setup.exe' $false
  if (-not $OnlyWeb) { Build 'KaidoNights-Setup-Completo.exe' $true }
} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host ''
Write-Host ('Pronto: instaladores da versao ' + $m.version + ' na pasta dist\') -ForegroundColor Green
