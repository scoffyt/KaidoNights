@echo off
setlocal EnableDelayedExpansion
title Kaido Nights - Criar instaladores
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js 22.13+ e necessario para publicar a versao ^(https://nodejs.org^).
  pause
  exit /b 1
)
set "PUB=S"
if exist "release\manifest.json" set /p PUB="Publicar uma NOVA versao local antes de gerar os instaladores? (S/N): "
if /i "!PUB!"=="S" (
  set "NOTAS="
  set /p NOTAS="Novidades desta versao (Enter para pular): "
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-native.ps1
  if errorlevel 1 ( pause & exit /b 1 )
  call node --no-warnings tools\release.mjs --native dist\native --notes "!NOTAS!"
  if errorlevel 1 ( pause & exit /b 1 )
)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-setup.ps1
pause
