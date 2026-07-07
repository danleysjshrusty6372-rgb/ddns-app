@echo off
title DDNS App - 安装
cd /d "%~dp0"
echo.
echo ============================================
echo   DDNS 动态域名解析服务 - 安装
echo ============================================
echo.
echo 正在安装依赖...
echo.
call npm install --registry=https://registry.npmmirror.com
echo.
if %errorlevel% equ 0 (
    echo ============================================
    echo   安装完成！
    echo   运行 start.bat 启动服务
    echo   浏览器访问 http://localhost:3000
    echo ============================================
) else (
    echo 安装失败，请检查 Node.js 是否已安装
    echo 下载: https://nodejs.org
)
pause
