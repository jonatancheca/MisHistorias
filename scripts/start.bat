@echo off
setlocal
set "ROOT=%~dp0"

if not exist "%ROOT%node.exe" (
  echo No se encuentra node.exe. Extrae todo app.zip antes de arrancar.
  pause
  exit /b 1
)

if not exist "%ROOT%install1\start-server.mjs" (
  echo No se encuentra install1\start-server.mjs. Extrae todo app.zip antes de arrancar.
  pause
  exit /b 1
)

start "MisHistorias" /D "%ROOT%install1" "%ROOT%node.exe" "%ROOT%install1\start-server.mjs"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3010"

endlocal
