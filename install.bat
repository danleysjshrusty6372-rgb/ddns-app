@echo off
echo ========================================
echo   DDNS Service Installer
echo ========================================
echo.
echo Installing dependencies...
cd /d "%~dp0"
call npm install --registry=https://registry.npmmirror.com
echo.
echo Installation complete!
echo.
echo To start the service, run: npm start
echo Or use the desktop shortcut: 启动DDNS.bat
echo.
pause
