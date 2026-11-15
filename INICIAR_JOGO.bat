@echo off
title KAIDO NIGHTS - Servidor local
cd /d "%~dp0"
echo Iniciando KAIDO NIGHTS...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
if not errorlevel 1 goto :eof
echo.
echo Servidor PowerShell indisponivel. Tentando Python...
where py >nul 2>nul
if not errorlevel 1 (
  start "" "http://localhost:8080/"
  py -m http.server 8080
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "http://localhost:8080/"
  python -m http.server 8080
  goto :eof
)
echo Nao foi possivel iniciar um servidor local. Veja o README.md.
pause
