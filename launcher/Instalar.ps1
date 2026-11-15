# =====================================================================
#  KAIDO NIGHTS - instalador / desinstalador (sem administrador)
#    Instalar.ps1                      instala ou atualiza em %LOCALAPPDATA%\Programs\KaidoNights
#    Instalar.ps1 -Source <manifest>   instala a partir de um manifesto especifico (URL ou pasta release)
#    Instalar.ps1 -Uninstall           remove o jogo (pergunta se apaga os saves)
#    Instalar.ps1 -Quiet               sem perguntas
# =====================================================================
param([string]$Source = '', [switch]$Uninstall, [switch]$Quiet)
. (Join-Path $PSScriptRoot 'KaidoCommon.ps1')
Add-Type -AssemblyName System.Windows.Forms

function Ask([string]$text, [string]$title = 'Kaido Nights') {
  if ($Quiet) { return $true }
  return ([System.Windows.Forms.MessageBox]::Show($text, $title, 'YesNo', 'Question') -eq 'Yes')
}
function Get-ShortcutPaths {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Kaido Nights'
  return @{ desktop = (Join-Path $desktop 'Kaido Nights.lnk'); menu = $menu }
}

# ---------------------------------------------------------------- uninstall
if ($Uninstall) {
  if (-not (Ask 'Desinstalar o Kaido Nights deste computador?')) { exit 0 }
  # run from a temp copy so the install folder can be deleted
  if ($PSScriptRoot.StartsWith($script:KaidoInstall, [StringComparison]::OrdinalIgnoreCase) -and -not $env:KAIDO_UNINSTALL_COPY) {
    $tmp = Join-Path $env:TEMP ('kaido-uninstall-' + $PID)
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    Copy-Item (Join-Path $PSScriptRoot 'Instalar.ps1'), (Join-Path $PSScriptRoot 'KaidoCommon.ps1') -Destination $tmp
    $env:KAIDO_UNINSTALL_COPY = '1'
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $tmp 'Instalar.ps1') + '"'), '-Uninstall', '-Quiet')
    exit 0
  }
  Start-Sleep -Milliseconds 800
  $sc = Get-ShortcutPaths
  Remove-Item -LiteralPath $sc.desktop -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $sc.menu -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $script:KaidoRegKey -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $script:KaidoInstall -Recurse -Force -ErrorAction SilentlyContinue
  $keepSaves = $true
  if ([System.Windows.Forms.MessageBox]::Show("Kaido Nights removido.`n`nApagar tambem seus saves, configuracoes e login (pasta $script:KaidoData)?", 'Kaido Nights', 'YesNo', 'Question') -eq 'Yes') {
    Remove-Item -LiteralPath $script:KaidoData -Recurse -Force -ErrorAction SilentlyContinue; $keepSaves = $false
  }
  Write-Host ('desinstalado; saves mantidos: ' + $keepSaves)
  exit 0
}

# ---------------------------------------------------------------- install / update
$keyFile = Join-Path $PSScriptRoot 'update-key.xml'
if (-not (Test-Path -LiteralPath $keyFile)) {
  [System.Windows.Forms.MessageBox]::Show("Esta pasta ainda nao tem uma versao publicada.`nRode primeiro CRIAR_INSTALADOR.bat (ou: node tools\release.mjs).", 'Kaido Nights', 'OK', 'Warning') | Out-Null
  exit 1
}
$keyXml = Get-Content -LiteralPath $keyFile -Raw
$win = New-KaidoWindow 'Instalador - Kaido Nights'
$prog = { param($t, $p) Set-KaidoWindow $win $t $p }
$extracted = $null
try {
  # where do the files come from?
  $sources = @()
  if ($Source) { $sources = @($Source) }
  else {
    $cands = @((Join-Path (Split-Path -Parent $PSScriptRoot) 'release\manifest.json'), (Join-Path $PSScriptRoot 'release\manifest.json'))
    foreach ($c in $cands) { if (Test-Path -LiteralPath $c) { $sources += $c } }
    $zip = Join-Path $PSScriptRoot 'game-release.zip'
    if (-not $sources -and (Test-Path -LiteralPath $zip)) {
      Set-KaidoWindow $win 'Extraindo o pacote do jogo...' 2
      $extracted = Join-Path $env:TEMP ('kaido-setup-' + $PID)
      Expand-Archive -LiteralPath $zip -DestinationPath $extracted -Force
      $sources += (Join-Path $extracted 'release\manifest.json')
    }
    $cfg = Read-KaidoConfig $PSScriptRoot
    $sources += $cfg.manifestUrls
  }
  if (-not $sources) { throw 'Nenhuma fonte de instalacao: rode tools\release.mjs ou configure update.json.' }
  Set-KaidoWindow $win 'Conectando...' 3
  $r = Get-RemoteManifest $sources $keyXml
  $win.notes.Text = 'Versao ' + $r.manifest.version + ' - instalando em ' + $script:KaidoInstall
  if (-not (Test-Path $script:KaidoInstall)) { New-Item -ItemType Directory -Path $script:KaidoInstall -Force | Out-Null }
  $n = Update-KaidoFiles $script:KaidoInstall $r.manifest $r.base $prog

  # shortcuts
  Set-KaidoWindow $win 'Criando atalhos...' 98
  $sh = New-Object -ComObject WScript.Shell
  $vbs = Join-Path $script:KaidoInstall 'launcher\KaidoNights.vbs'
  $ico = Join-Path $script:KaidoInstall 'launcher\kaido.ico'
  $sc = Get-ShortcutPaths
  if (-not (Test-Path -LiteralPath $sc.menu)) { New-Item -ItemType Directory -Path $sc.menu -Force | Out-Null }
  $mk = {
    param($path, $argsLine, $desc)
    $l = $sh.CreateShortcut($path)
    $l.TargetPath = (Join-Path $env:WINDIR 'System32\wscript.exe')
    $l.Arguments = $argsLine
    $l.WorkingDirectory = $script:KaidoInstall
    $l.IconLocation = $ico
    $l.Description = $desc
    $l.Save()
  }
  & $mk $sc.desktop ('"' + $vbs + '"') 'Jogar Kaido Nights'
  & $mk (Join-Path $sc.menu 'Kaido Nights.lnk') ('"' + $vbs + '"') 'Jogar Kaido Nights'
  & $mk (Join-Path $sc.menu 'Reparar Kaido Nights.lnk') ('"' + $vbs + '" repair') 'Confere e corrige os arquivos do jogo'
  $un = $sh.CreateShortcut((Join-Path $sc.menu 'Desinstalar Kaido Nights.lnk'))
  $un.TargetPath = 'powershell.exe'
  $un.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $script:KaidoInstall 'launcher\Instalar.ps1') + '" -Uninstall'
  $un.IconLocation = $ico; $un.Save()

  # "Aplicativos instalados" entry (per user)
  if (-not (Test-Path $script:KaidoRegKey)) { New-Item -Path $script:KaidoRegKey -Force | Out-Null }
  $size = [int]((@($r.manifest.files) | Measure-Object -Property s -Sum).Sum / 1KB)
  $props = @{
    DisplayName = 'Kaido Nights'; DisplayVersion = [string]$r.manifest.version; Publisher = 'Kaido Nights'
    InstallLocation = $script:KaidoInstall; DisplayIcon = $ico
    UninstallString = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $script:KaidoInstall 'launcher\Instalar.ps1') + '" -Uninstall'
  }
  foreach ($k in $props.Keys) { New-ItemProperty -Path $script:KaidoRegKey -Name $k -Value $props[$k] -PropertyType String -Force | Out-Null }
  foreach ($k in @('NoModify', 'NoRepair')) { New-ItemProperty -Path $script:KaidoRegKey -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
  New-ItemProperty -Path $script:KaidoRegKey -Name 'EstimatedSize' -Value $size -PropertyType DWord -Force | Out-Null

  Set-KaidoWindow $win ('Kaido Nights ' + $r.manifest.version + ' instalado!') 100
  Write-KaidoLog ('instalado ' + $r.manifest.version + ' a partir de ' + $r.url)
  $win.form.Close()
  if (Ask ("Kaido Nights " + $r.manifest.version + " instalado.`nAtalhos criados na area de trabalho e no menu Iniciar.`nO jogo se atualiza sozinho ao abrir.`n`nJogar agora?")) {
    Start-Process (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + $vbs + '"')
  }
} catch {
  Write-KaidoLog ('instalacao falhou: ' + $_.Exception.Message)
  try { $win.form.Close() } catch { }
  [System.Windows.Forms.MessageBox]::Show("Nao foi possivel instalar:`n`n" + $_.Exception.Message, 'Kaido Nights', 'OK', 'Error') | Out-Null
  exit 1
} finally {
  if ($extracted) { Remove-Item -LiteralPath $extracted -Recurse -Force -ErrorAction SilentlyContinue }
}
