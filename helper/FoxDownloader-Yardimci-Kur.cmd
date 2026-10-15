@echo off
chcp 65001 >nul
setlocal
set "VDH_ARGS=%*"
if not exist "%~dp0FoxDownloader-Yardimci-Kur.ps1" (
    echo.
    echo   HATA: FoxDownloader-Yardimci-Kur.ps1 bulunamadi.
    echo   Iki dosya da ayni klasorde olmali ^(genellikle Indirilenler^).
    echo.
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0FoxDownloader-Yardimci-Kur.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto vdFail
exit /b 0
:vdFail
echo.
echo   PowerShell hata kodu: %RC%
pause
exit /b 1
