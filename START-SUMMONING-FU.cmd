@echo off
cd /d "%~dp0"
node scripts\start-desktop.cjs --detached %*
if errorlevel 1 pause
