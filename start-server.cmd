@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PY=C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
if not exist "%PY%" set PY=python

echo.
echo   学生手册查询网页 —— 手机访问
echo   ------------------------------------------------------------
echo   手机连上和这台电脑同一个 Wi-Fi，然后在手机浏览器里打开：
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo        http://%%a:5178
echo.
echo   电脑上自己看： http://127.0.0.1:5178
echo   关掉这个窗口（或按 Ctrl+C）即可停止。
echo.
"%PY%" -m http.server 5178 --bind 0.0.0.0
pause
