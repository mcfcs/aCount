@echo off
setlocal

cd /d "%~dp0"
set "ROOT=%CD%"

echo.
if not exist "%ROOT%\venv\Scripts\python.exe" (
  echo [ERROR] Python virtual env not found at:
  echo   %ROOT%\venv\Scripts\python.exe
  echo.
  echo Please create a virtual env in this folder and activate/install deps first.
  pause
  exit /b 1
)

if not exist "%ROOT%\frontend\package.json" (
  echo [ERROR] frontend package not found at:
  echo   %ROOT%\frontend\package.json
  pause
  exit /b 1
)

where python >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] python is not available in PATH.
  pause
  exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] npm is not available in PATH.
  pause
  exit /b 1
)

echo Starting backend...
start "aCount Backend" cmd /k "cd /d %ROOT% && venv\Scripts\python.exe run.py"

echo Starting frontend...
start "aCount Frontend" cmd /k "cd /d %ROOT%\frontend && npm run dev -- --host 0.0.0.0 --port 5173"

echo.
echo Started. Close the new windows when you are done.
pause
