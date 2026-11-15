@echo off
title Kaido Nights - Servidor Online
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale o Node.js 22 LTS ^(22.13 ou mais novo^) em https://nodejs.org
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo [ERRO] Node.js muito antigo. Necessario 22.13 ou mais novo. Versao atual:
  node -v
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
echo.
echo  ==============================================
echo   KAIDO NIGHTS - SERVIDOR MULTIPLAYER
echo   Neste PC:      http://localhost:8090
echo   Na rede local: http://SEU-IP:8090  ^(veja ipconfig^)
echo   Feche esta janela para desligar o servidor.
echo  ==============================================
echo.
start "" http://localhost:8090
node --no-warnings server\index.js
pause
