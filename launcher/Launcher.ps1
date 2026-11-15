# =====================================================================
#  KAIDO NIGHTS - launcher: verifica/aplica atualizacoes e abre o jogo
#    Launcher.ps1            (normal: atualiza se houver versao nova e joga)
#    Launcher.ps1 -Repair    (confere o hash de todos os arquivos e corrige)
#    Launcher.ps1 -NoUpdate  (joga sem verificar)
# =====================================================================
param([switch]$Repair, [switch]$NoUpdate)
. (Join-Path $PSScriptRoot 'KaidoCommon.ps1')

$installDir = Split-Path -Parent $PSScriptRoot

# migration: installs made before the native app point their shortcuts at this script.
# When KaidoNights.exe exists, repoint the shortcuts and hand over to it.
$nativeExe = Join-Path $installDir 'KaidoNights.exe'
if (Test-Path -LiteralPath $nativeExe) {
  try {
    $sh = New-Object -ComObject WScript.Shell
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Kaido Nights'
    $links = @(@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Kaido Nights.lnk'), ''), @((Join-Path $menu 'Kaido Nights.lnk'), ''), @((Join-Path $menu 'Reparar Kaido Nights.lnk'), '--repair'))
    foreach ($l in $links) {
      if (Test-Path -LiteralPath $l[0]) { $k = $sh.CreateShortcut($l[0]); $k.TargetPath = $nativeExe; $k.Arguments = $l[1]; $k.WorkingDirectory = $installDir; $k.IconLocation = $nativeExe + ',0'; $k.Save() }
    }
    Set-ItemProperty -Path $script:KaidoRegKey -Name 'DisplayIcon' -Value $nativeExe -ErrorAction SilentlyContinue
  } catch { Write-KaidoLog ('migracao de atalhos falhou: ' + $_.Exception.Message) }
  $a = @(); if ($Repair) { $a += '--repair' }; if ($NoUpdate) { $a += '--no-update' }
  if ($a.Count) { Start-Process -FilePath $nativeExe -WorkingDirectory $installDir -ArgumentList $a } else { Start-Process -FilePath $nativeExe -WorkingDirectory $installDir }
  exit 0
}
$cfg = Read-KaidoConfig $PSScriptRoot
$keyXml = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'update-key.xml') -Raw
$win = New-KaidoWindow 'Kaido Nights'
$prog = { param($t, $p) Set-KaidoWindow $win $t $p }

# ---------------------------------------------------------------- update
if (-not $NoUpdate -and $cfg.manifestUrls.Count -gt 0) {
  try {
    Set-KaidoWindow $win 'Procurando atualizacoes...' 3
    $r = Get-RemoteManifest $cfg.manifestUrls $keyXml
    $local = Get-LocalManifest $installDir
    $localVer = '0.0.0'; if ($local) { $localVer = [string]$local.version }
    $newer = (Compare-KaidoVersion ([string]$r.manifest.version) $localVer) -gt 0
    if ($newer -or $Repair) {
      if ($newer) {
        Set-KaidoWindow $win ('Atualizando ' + $localVer + ' -> ' + $r.manifest.version) 8
        if ($r.manifest.PSObject.Properties['notes'] -and $r.manifest.notes) { $win.notes.Text = 'Novidades: ' + $r.manifest.notes }
      } else { Set-KaidoWindow $win 'Verificando a instalacao...' 5 }
      $n = Update-KaidoFiles $installDir $r.manifest $r.base $prog -Verify:$Repair
      Set-KaidoWindow $win ('Versao ' + $r.manifest.version + ' pronta (' + $n + ' arquivos atualizados)') 100
      Start-Sleep -Milliseconds 600
    } else { Set-KaidoWindow $win ('Versao ' + $localVer + ' (atualizada)') 100 }
  } catch {
    Write-KaidoLog ('atualizacao nao concluida: ' + $_.Exception.Message)
    Set-KaidoWindow $win 'Nao foi possivel atualizar agora - abrindo a versao instalada.' 100
    $win.notes.Text = $_.Exception.Message
    Start-Sleep -Seconds 2
  }
}

# the update may have just installed the native app: use it from now on
if (Test-Path -LiteralPath $nativeExe) {
  $win.form.Close()
  Start-Process -FilePath $nativeExe -WorkingDirectory $installDir -ArgumentList '--no-update'
  exit 0
}

# ---------------------------------------------------------------- start the game
function Find-Browser([string]$pref) {
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe")
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  $order = $edge + $chrome
  if ($pref -eq 'chrome') { $order = $chrome + $edge }
  foreach ($b in $order) { if ($b -and (Test-Path -LiteralPath $b)) { return $b } }
  return $null
}

$server = $null
$url = $cfg.playUrl
if (-not $url) {
  Set-KaidoWindow $win 'Iniciando o jogo...' 100
  $portFile = Join-Path $env:TEMP ('kaido-port-' + $PID + '.txt')
  Remove-Item -LiteralPath $portFile -Force -ErrorAction SilentlyContinue
  $srvScript = Join-Path $installDir 'servidor.ps1'
  $server = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $srvScript + '"'), '-NoBrowser', '-PortFile', ('"' + $portFile + '"'), '-ParentPid', $PID)
  $t0 = [DateTime]::Now
  while (-not (Test-Path -LiteralPath $portFile)) {
    [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100
    if (([DateTime]::Now - $t0).TotalSeconds -gt 15 -or $server.HasExited) { break }
  }
  if (-not (Test-Path -LiteralPath $portFile)) {
    [System.Windows.Forms.MessageBox]::Show('Nao foi possivel iniciar o servidor local do jogo (portas 8080-8099 ocupadas?).', 'Kaido Nights') | Out-Null
    exit 1
  }
  Start-Sleep -Milliseconds 250
  $port = (Get-Content -LiteralPath $portFile -Raw).Trim()
  Remove-Item -LiteralPath $portFile -Force -ErrorAction SilentlyContinue
  $url = 'http://localhost:' + $port + '/'
}
Write-KaidoLog ('abrindo ' + $url)

$browser = Find-Browser $cfg.browser
$win.form.Close()
if ($browser) {
  # separate profile = the game runs as its own window/app (saves live in this profile) and we know when it closes
  $profDir = Join-Path $script:KaidoData 'browser-profile'
  $bargs = @('--app=' + $url, '--user-data-dir="' + $profDir + '"', '--no-first-run', '--no-default-browser-check', '--start-maximized', '--autoplay-policy=no-user-gesture-required', '--disable-features=Translate')
  $b = Start-Process -FilePath $browser -ArgumentList $bargs -PassThru
  $b.WaitForExit()
  # the first process may hand off to a child: wait until no browser process uses our profile
  for ($i = 0; $i -lt 7200; $i++) {
    $alive = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profDir) })
    if ($alive.Count -eq 0) { break }
    Start-Sleep -Seconds 2
  }
} else {
  Start-Process $url
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("O jogo abriu no seu navegador.`nClique em OK quando terminar de jogar para desligar o servidor local.", 'Kaido Nights') | Out-Null
}
if ($server -and -not $server.HasExited) { try { Stop-Process -Id $server.Id -Force } catch { } }
