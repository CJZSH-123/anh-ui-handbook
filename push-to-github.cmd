@echo off
chcp 65001 >nul
cd /d "%~dp0"
set NODE=C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
if not exist "%NODE%" set NODE=node
"%NODE%" "tools\push.js"
echo.
pause
