@echo off
rem Doble clic para levantar GitSight en Windows (usa start.ps1).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 (
  echo.
  echo Hubo un problema. Lee el mensaje de arriba.
  pause
)
