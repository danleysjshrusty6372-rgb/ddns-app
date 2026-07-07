@echo off
title DDNS App
cd /d "%~dp0"
echo.
echo ============================================
echo   DDNS 动态域名解析服务
echo ============================================
echo.
echo 启动中...
echo.
node src/server.js
pause
