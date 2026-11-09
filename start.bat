@echo off
chcp 65001 >nul
title 展翅翱翔 · 在线对局服务器
cd /d "%~dp0"
echo.
echo  ============================
echo   展翅翱翔 · 在线对局
echo   启动后请用浏览器打开：
echo   http://localhost:8420
echo  ============================
echo.
start "" http://localhost:8420
node server\server.js
pause
