@echo off
title Kaido Nights - Instalador
cd /d "%~dp0"
set "L=%~dp0launcher"
if not exist "%L%\Instalar.ps1" set "L=%~dp0"
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%L%\Instalar.ps1" %*
if errorlevel 1 pause
