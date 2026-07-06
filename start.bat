@echo off
chcp 65001 >nul
title DDNS 动态域名解析服务

echo ========================================
echo   DDNS 动态域名解析服务
echo ========================================
echo.

cd /d "%~dp0"

REM 检查 Node.js 是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 14.0 或更高版本
    echo 下载地址: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM 检查依赖是否安装
if not exist "node_modules" (
    echo [信息] 正在安装依赖，请稍候...
    call npm install --production
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo [信息] 依赖安装完成
    echo.
)

echo [信息] 正在启动 DDNS 服务...
echo [信息] 服务启动后，请在浏览器中访问: http://localhost:3000
echo [信息] 按 Ctrl+C 可停止服务
echo.
echo ========================================
echo.

node server.js

pause
