# KAIDO NIGHTS - servidor local (sem dependencias). Serve esta pasta em http://localhost:PORTA/
#   -NoBrowser        nao abre o navegador (usado pelo launcher)
#   -PortFile <arq>   grava a porta escolhida neste arquivo
#   -ParentPid <pid>  encerra sozinho quando esse processo terminar
param([switch]$NoBrowser, [string]$PortFile = '', [int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8';
  '.css'='text/css; charset=utf-8'; '.json'='application/json'; '.glb'='model/gltf-binary'; '.gltf'='model/gltf+json';
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.svg'='image/svg+xml'; '.ico'='image/x-icon';
  '.wav'='audio/wav'; '.mp3'='audio/mpeg'; '.ogg'='audio/ogg'; '.txt'='text/plain; charset=utf-8'; '.md'='text/plain; charset=utf-8'
}
$listener = $null
$port = 0
foreach ($p in 8080..8099) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l; $port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host 'Nao foi possivel abrir uma porta entre 8080 e 8099.' -ForegroundColor Red; exit 1 }
$url = "http://localhost:$port/"
Write-Host ''
Write-Host '  KAIDO NIGHTS - Hakone Bay Drift Circuit' -ForegroundColor Magenta
Write-Host "  Servidor rodando em $url" -ForegroundColor Cyan
Write-Host '  Mantenha esta janela aberta enquanto joga. Feche-a para encerrar.' -ForegroundColor Gray
Write-Host ''
if ($PortFile) { Set-Content -LiteralPath $PortFile -Value $port -Encoding ASCII }
if (-not $NoBrowser) { Start-Process $url }
while ($listener.IsListening) {
  try {
    $ar = $listener.BeginGetContext($null, $null)
    while (-not $ar.AsyncWaitHandle.WaitOne(1000)) {
      if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { $listener.Stop(); exit 0 }
    }
    $ctx = $listener.EndGetContext($ar)
    $req = $ctx.Request; $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrEmpty($path)) { $path = 'index.html' }
    $file = [System.IO.Path]::GetFullPath((Join-Path $root $path))
    if (-not $file.StartsWith($root) -or $path -like '.kaido*' -or -not (Test-Path $file -PathType Leaf)) {
      $res.StatusCode = 404
      $b = [System.Text.Encoding]::UTF8.GetBytes('404')
      $res.OutputStream.Write($b, 0, $b.Length)
    } else {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
      $res.ContentType = $ct
      $res.Headers.Add('Cache-Control', 'no-cache')
      $fs = [System.IO.File]::OpenRead($file)
      $res.ContentLength64 = $fs.Length
      try { $fs.CopyTo($res.OutputStream) } finally { $fs.Close() }
    }
    $res.OutputStream.Close()
  } catch { try { $res.Abort() } catch { } }
}
