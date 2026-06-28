@echo off
title Phishing Scanner Web App Server Launcher
echo ==========================================================
echo   Phishing Scanner Web Application Server Launcher (Port 8002)
echo ==========================================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% equ 0 (
    set PY_CMD=python
    goto python_found
)

py --version >nul 2>&1
if %errorlevel% equ 0 (
    set PY_CMD=py
    goto python_found
)

echo [ERROR] Python is not installed or not added to your PATH.
echo Please install Python 3.10+ and check "Add Python to PATH".
pause
exit /b 1

:python_found
echo Using Python command: %PY_CMD%

echo [1/3] Installing Python dependencies from requirements.txt...
%PY_CMD% -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [WARNING] Dependency installation finished with errors.
)

echo.
echo [2/3] Installing Playwright browser engines...
%PY_CMD% -m playwright install chromium firefox
if %errorlevel% neq 0 (
    echo [WARNING] Playwright browser installation finished with warnings.
)

echo.
echo [3/3] Launching Phishing Scanner FastAPI server on port 8002...
echo ==========================================================
echo   Open your browser at: http://localhost:8002
echo ==========================================================
echo.

%PY_CMD% -m uvicorn app.main:app --port 8002 --reload
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server terminated unexpectedly.
    pause
)
