@echo off
chcp 65001 >nul
:: 尝试直接添加；若权限不足则自动以管理员身份重启本脚本
netsh advfirewall firewall show rule name="Wingspan 8420" >nul 2>&1
if %errorlevel%==0 (
    echo 防火墙规则已存在，无需重复添加。
    pause
    exit /b
)
netsh advfirewall firewall add rule name="Wingspan 8420" dir=in action=allow protocol=TCP localport=8420 >nul 2>&1
if %errorlevel% neq 0 (
    echo 需要管理员权限，正在请求提升……
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
echo.
echo  ✅ 防火墙已放行端口 8420，朋友们可以访问了！
echo.
pause
