@echo off
cd /d "%~dp0"
node scripts\start-roll-preview.cjs --detached
if errorlevel 1 pause
