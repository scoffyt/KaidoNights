# =====================================================================
#  KAIDO NIGHTS - funcoes compartilhadas do instalador e do launcher
#  (Windows PowerShell 5.1, sem dependencias)
#
#  Canal de atualizacao:  <base>/manifest.json  +  manifest.json.sig  +  objects/<sha256>
#  - a assinatura RSA-SHA256 do manifesto e verificada com a chave publica (update-key.xml)
#  - cada arquivo baixado tem o SHA-256 conferido antes de ser instalado
#  - nada e substituido antes de tudo estar baixado; falha na aplicacao = restauracao do backup
# =====================================================================
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

$script:KaidoAppName   = 'Kaido Nights'
$script:KaidoInstall   = Join-Path $env:LOCALAPPDATA 'Programs\KaidoNights'
$script:KaidoData      = Join-Path $env:LOCALAPPDATA 'KaidoNights'
$script:KaidoRegKey    = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\KaidoNights'
$script:LauncherVersion = 1

function Write-KaidoLog([string]$msg) {
  try {
    if (-not (Test-Path $script:KaidoData)) { New-Item -ItemType Directory -Path $script:KaidoData -Force | Out-Null }
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
    Add-Content -LiteralPath (Join-Path $script:KaidoData 'launcher.log') -Value $line -Encoding UTF8
  } catch { }
}

function Read-KaidoConfig([string]$dir) {
  # update.json: { "manifestUrls": ["https://.../updates/manifest.json"], "playUrl": "", "browser": "auto" }
  $cfg = [pscustomobject]@{ manifestUrls = @(); playUrl = ''; browser = 'auto' }
  $f = Join-Path $dir 'update.json'
  if (Test-Path -LiteralPath $f) {
    $j = Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j.PSObject.Properties['manifestUrls'] -and $j.manifestUrls) { $cfg.manifestUrls = @($j.manifestUrls) }
    if ($j.PSObject.Properties['playUrl'] -and $j.playUrl) { $cfg.playUrl = [string]$j.playUrl }
    if ($j.PSObject.Properties['browser'] -and $j.browser) { $cfg.browser = [string]$j.browser }
  }
  return $cfg
}

function Test-IsRemote([string]$u) { return ($u -match '^https?://') }

function Get-BaseOf([string]$manifestUrl) {
  if (Test-IsRemote $manifestUrl) { return $manifestUrl.Substring(0, $manifestUrl.LastIndexOf('/')) }
  return (Split-Path -Parent $manifestUrl)
}

function Join-Source([string]$base, [string]$name) {
  if (Test-IsRemote $base) { return ($base.TrimEnd('/') + '/' + $name) }
  return (Join-Path $base ($name -replace '/', '\'))
}

function Get-SourceBytes([string]$src) {
  if (Test-IsRemote $src) {
    $req = [System.Net.HttpWebRequest]::Create($src + '?t=' + [DateTime]::UtcNow.Ticks)
    $req.UserAgent = 'KaidoLauncher/' + $script:LauncherVersion
    $req.Headers.Add('Cache-Control', 'no-cache')
    $req.Timeout = 8000; $req.ReadWriteTimeout = 15000
    $resp = $req.GetResponse()
    try {
      $ms = New-Object System.IO.MemoryStream
      $resp.GetResponseStream().CopyTo($ms)
      return ,$ms.ToArray()
    } finally { $resp.Close() }
  }
  return ,[System.IO.File]::ReadAllBytes($src)
}

# copies/downloads $src to $dest, calling $onBytes with the number of bytes of each chunk
function Save-Source([string]$src, [string]$dest, [scriptblock]$onBytes) {
  $dir = Split-Path -Parent $dest
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $in = $null; $resp = $null; $out = $null
  try {
    if (Test-IsRemote $src) {
      $req = [System.Net.HttpWebRequest]::Create($src)
      $req.UserAgent = 'KaidoLauncher/' + $script:LauncherVersion
      $req.Timeout = 30000; $req.ReadWriteTimeout = 60000
      $resp = $req.GetResponse(); $in = $resp.GetResponseStream()
    } else { $in = [System.IO.File]::OpenRead($src) }
    $out = [System.IO.File]::Create($dest)
    $buf = New-Object byte[] 262144
    while ($true) {
      $n = $in.Read($buf, 0, $buf.Length)
      if ($n -le 0) { break }
      $out.Write($buf, 0, $n)
      if ($onBytes) { & $onBytes $n }
    }
  } finally {
    if ($out) { $out.Close() }
    if ($in) { $in.Close() }
    if ($resp) { $resp.Close() }
  }
}

function Get-Sha256([string]$path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() }

function Test-ManifestSignature([byte[]]$bytes, [string]$sigB64, [string]$keyXml) {
  $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
  try {
    $rsa.FromXmlString($keyXml)
    $sig = [Convert]::FromBase64String($sigB64.Trim())
    $sha = New-Object System.Security.Cryptography.SHA256CryptoServiceProvider
    return $rsa.VerifyData($bytes, $sha, $sig)
  } finally { $rsa.Dispose() }
}

# downloads + verifies the manifest. Returns @{ manifest; base; url } or throws.
function Get-RemoteManifest([string[]]$urls, [string]$keyXml) {
  $errors = @()
  foreach ($u in $urls) {
    try {
      $bytes = Get-SourceBytes $u
      $sigBytes = Get-SourceBytes ($u + '.sig')
      $sigText = [System.Text.Encoding]::ASCII.GetString($sigBytes)
      if (-not (Test-ManifestSignature $bytes $sigText $keyXml)) { throw 'assinatura do manifesto invalida' }
      $m = [System.Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
      if ($m.app -ne 'kaido-nights') { throw 'manifesto de outro aplicativo' }
      return @{ manifest = $m; base = (Get-BaseOf $u); url = $u }
    } catch {
      $errors += ($u + ': ' + $_.Exception.Message)
      Write-KaidoLog ('manifesto falhou ' + $u + ' - ' + $_.Exception.Message)
    }
  }
  throw ('Nenhum servidor de atualizacao respondeu. ' + ($errors -join ' | '))
}

function Get-LocalManifest([string]$installDir) {
  $f = Join-Path $installDir '.kaido\manifest.json'
  if (-not (Test-Path -LiteralPath $f)) { return $null }
  try { return (Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Compare-KaidoVersion([string]$a, [string]$b) {
  $x = $a.Split('.') | ForEach-Object { [int]$_ }; $y = $b.Split('.') | ForEach-Object { [int]$_ }
  for ($i = 0; $i -lt 3; $i++) { if ($x[$i] -ne $y[$i]) { return ($x[$i] - $y[$i]) } }
  return 0
}

# Brings $installDir to the state described by $remote (manifest object), downloading from $base.
# $progress: scriptblock(text, percent 0..100)
# -Verify : re-hashes every installed file (repair) instead of trusting the local manifest
function Update-KaidoFiles([string]$installDir, $remote, [string]$base, [scriptblock]$progress, [switch]$Verify) {
  $local = Get-LocalManifest $installDir
  $localIdx = @{}
  if ($local) { foreach ($f in $local.files) { $localIdx[$f.p] = $f.h } }
  # 1. what is missing or different
  $need = New-Object System.Collections.ArrayList
  $i = 0; $count = @($remote.files).Count
  foreach ($f in $remote.files) {
    $i++
    $dest = Join-Path $installDir ($f.p -replace '/', '\')
    $ok = $false
    if (Test-Path -LiteralPath $dest) {
      if ($Verify) {
        if ($progress -and ($i % 20 -eq 0)) { & $progress ('Verificando arquivos ' + $i + '/' + $count) ([int](10 * $i / $count)) }
        $ok = ((Get-Sha256 $dest) -eq $f.h)
      } elseif ($localIdx.ContainsKey($f.p) -and $localIdx[$f.p] -eq $f.h -and (Get-Item -LiteralPath $dest).Length -eq [long]$f.s) { $ok = $true }
    }
    if (-not $ok) { [void]$need.Add($f) }
  }
  $removed = @()
  if ($local) {
    $remoteIdx = @{}; foreach ($f in $remote.files) { $remoteIdx[$f.p] = $true }
    $removed = @($local.files | Where-Object { -not $remoteIdx.ContainsKey($_.p) })
  }
  if ($need.Count -eq 0 -and $removed.Count -eq 0) { Save-LocalManifest $installDir $remote; return 0 }

  # 2. download everything to staging (verified), nothing touched yet
  $staging = Join-Path $script:KaidoData 'staging'
  if (-not (Test-Path $staging)) { New-Item -ItemType Directory -Path $staging -Force | Out-Null }
  [long]$totalBytes = 0; foreach ($f in $need) { $totalBytes += [long]$f.s }
  $state = @{ done = [long]0; last = [DateTime]::MinValue }
  $mb = { param($b) [math]::Round($b / 1MB, 1) }
  $k = 0
  foreach ($f in $need) {
    $k++
    $tmp = Join-Path $staging $f.h
    if ((Test-Path -LiteralPath $tmp) -and ((Get-Sha256 $tmp) -eq $f.h)) { $state.done += [long]$f.s; continue }   # resumed download
    # GitHub channel: files are fetched from the repository at the published commit (fileBase);
    # self-hosted channel: content-addressed objects/<sha256>
    if ($f.PSObject.Properties['u'] -and $f.u) { $src = [string]$f.u }
    elseif ($remote.PSObject.Properties['fileBase'] -and $remote.fileBase) {
      $enc = ($f.p.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
      $src = ([string]$remote.fileBase).TrimEnd('/') + '/' + $enc
    } else { $src = Join-Source $base ('objects/' + $f.h) }
    $tries = 0
    while ($true) {
      $tries++
      $before = $state.done
      try {
        Save-Source $src $tmp {
          param($n)
          $state.done += $n
          if ($progress -and (([DateTime]::Now - $state.last).TotalMilliseconds -gt 120)) {
            $state.last = [DateTime]::Now
            $pct = 10 + [int](85 * $state.done / [math]::Max(1, $totalBytes))
            & $progress ('Baixando ' + $k + '/' + $need.Count + '  (' + (& $mb $state.done) + ' / ' + (& $mb $totalBytes) + ' MB)') $pct
          }
        }
        if ((Get-Sha256 $tmp) -ne $f.h) { throw ('arquivo corrompido: ' + $f.p) }
        break
      } catch {
        $state.done = $before
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        Write-KaidoLog ('falha baixando ' + $f.p + ' (tentativa ' + $tries + '): ' + $_.Exception.Message)
        if ($tries -ge 3) { throw ('Falha ao baixar ' + $f.p + ': ' + $_.Exception.Message) }
        Start-Sleep -Seconds 2
      }
    }
  }

  # 3. apply with backup (rollback on any error)
  if ($progress) { & $progress 'Instalando arquivos...' 96 }
  $backup = Join-Path $script:KaidoData ('backup\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $applied = New-Object System.Collections.ArrayList
  try {
    foreach ($f in $need) {
      $dest = Join-Path $installDir ($f.p -replace '/', '\')
      $destDir = Split-Path -Parent $dest
      if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
      $hadOld = Test-Path -LiteralPath $dest
      if ($hadOld) {
        $bk = Join-Path $backup ($f.p -replace '/', '\')
        $bkDir = Split-Path -Parent $bk
        if (-not (Test-Path -LiteralPath $bkDir)) { New-Item -ItemType Directory -Path $bkDir -Force | Out-Null }
        Copy-Item -LiteralPath $dest -Destination $bk -Force
      }
      Copy-Item -LiteralPath (Join-Path $staging $f.h) -Destination $dest -Force
      [void]$applied.Add(@{ dest = $dest; hadOld = $hadOld; rel = $f.p })
    }
    foreach ($f in $removed) {
      $dest = Join-Path $installDir ($f.p -replace '/', '\')
      if (Test-Path -LiteralPath $dest) {
        $bk = Join-Path $backup ($f.p -replace '/', '\')
        $bkDir = Split-Path -Parent $bk
        if (-not (Test-Path -LiteralPath $bkDir)) { New-Item -ItemType Directory -Path $bkDir -Force | Out-Null }
        Move-Item -LiteralPath $dest -Destination $bk -Force
        [void]$applied.Add(@{ dest = $dest; hadOld = $true; rel = $f.p; removed = $true })
      }
    }
    Save-LocalManifest $installDir $remote
  } catch {
    Write-KaidoLog ('erro aplicando atualizacao, restaurando: ' + $_.Exception.Message)
    foreach ($a in $applied) {
      try {
        $bk = Join-Path $backup ($a.rel -replace '/', '\')
        if ($a.hadOld -and (Test-Path -LiteralPath $bk)) { Copy-Item -LiteralPath $bk -Destination $a.dest -Force }
        elseif (-not $a.hadOld) { Remove-Item -LiteralPath $a.dest -Force -ErrorAction SilentlyContinue }
      } catch { }
    }
    throw
  }
  # 4. cleanup: staging and old backups (keep the last 2)
  foreach ($f in $need) { Remove-Item -LiteralPath (Join-Path $staging $f.h) -Force -ErrorAction SilentlyContinue }
  $bkRoot = Join-Path $script:KaidoData 'backup'
  if (Test-Path $bkRoot) { Get-ChildItem $bkRoot -Directory | Sort-Object Name -Descending | Select-Object -Skip 2 | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue } }
  Write-KaidoLog ('atualizado para ' + $remote.version + ': ' + $need.Count + ' arquivos, ' + $removed.Count + ' removidos')
  return $need.Count
}

function Save-LocalManifest([string]$installDir, $m) {
  $d = Join-Path $installDir '.kaido'
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  $json = $m | ConvertTo-Json -Depth 6 -Compress
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $d 'manifest.json'), $json, $utf8)
  # version shown in the game menu
  $notes = ''; if ($m.PSObject.Properties['notes'] -and $m.notes) { $notes = [string]$m.notes }
  $v = @{ version = [string]$m.version; released = [string]$m.released; notes = $notes } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText((Join-Path $installDir 'version.json'), $v, $utf8)
}

# ---- small progress window (WinForms) -------------------------------------
function New-KaidoWindow([string]$title) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $f = New-Object System.Windows.Forms.Form
  $f.Text = $title; $f.Width = 560; $f.Height = 250; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false
  $f.StartPosition = 'CenterScreen'; $f.BackColor = [System.Drawing.Color]::FromArgb(10, 52, 52); $f.ForeColor = [System.Drawing.Color]::White
  $ico = Join-Path $PSScriptRoot 'kaido.ico'
  if (Test-Path -LiteralPath $ico) { try { $f.Icon = New-Object System.Drawing.Icon($ico) } catch { } }
  $t = New-Object System.Windows.Forms.Label
  $t.Text = 'KAIDO NIGHTS'; $t.Font = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Bold); $t.AutoSize = $true; $t.Left = 22; $t.Top = 16
  $t.ForeColor = [System.Drawing.Color]::FromArgb(204, 255, 0)
  $l = New-Object System.Windows.Forms.Label
  $l.Text = ''; $l.Font = New-Object System.Drawing.Font('Segoe UI', 10); $l.Left = 24; $l.Top = 70; $l.Width = 500; $l.Height = 40
  $p = New-Object System.Windows.Forms.ProgressBar
  $p.Left = 24; $p.Top = 114; $p.Width = 496; $p.Height = 18; $p.Minimum = 0; $p.Maximum = 100
  $n = New-Object System.Windows.Forms.Label
  $n.Text = ''; $n.Font = New-Object System.Drawing.Font('Segoe UI', 9); $n.Left = 24; $n.Top = 142; $n.Width = 500; $n.Height = 54; $n.ForeColor = [System.Drawing.Color]::FromArgb(180, 220, 220)
  $f.Controls.AddRange(@($t, $l, $p, $n))
  $f.Show(); [System.Windows.Forms.Application]::DoEvents()
  return @{ form = $f; label = $l; bar = $p; notes = $n }
}
function Set-KaidoWindow($w, [string]$text, [int]$pct) {
  if (-not $w) { return }
  if ($text) { $w.label.Text = $text }
  if ($pct -ge 0) { $w.bar.Value = [math]::Max(0, [math]::Min(100, $pct)) }
  [System.Windows.Forms.Application]::DoEvents()
}
