@echo off
cd /d "%~dp0"
node scripts\start-paperlab-preview.cjs --detached
if errorlevel 1 pause
