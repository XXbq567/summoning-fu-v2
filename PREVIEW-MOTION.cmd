@echo off
cd /d "%~dp0"
node scripts\start-desktop.cjs --detached --motion-preview
if errorlevel 1 pause
