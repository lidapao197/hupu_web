@echo off
title 虎扑网页版
cd /d "%~dp0"

echo ===============================================
echo   虎扑网页版 启动脚本
echo ===============================================
echo.

rem 检查依赖是否已安装
if not exist "node_modules\express" (
    echo 首次运行，正在安装依赖，请稍候...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo 依赖安装失败，请检查 Node.js 是否已安装以及网络是否正常
        echo.
        pause
        exit /b 1
    )
)

rem 如果 9003 端口已被占用，先结束旧进程，避免启动失败
set "KILLED="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :9003 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
    if not defined KILLED (
        echo 检测到端口 9003 被占用，已结束旧进程
        set "KILLED=1"
    )
)

echo 正在启动服务...
echo.

node server.js

echo.
echo 服务已停止。
pause
