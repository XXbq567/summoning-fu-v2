@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
pushd "%~dp0.."
if not exist "node_modules\electron\dist\electron.exe" (
  echo Local Electron is missing. Open paper-material-study.html in a browser.
  pause
  popd
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0paper-material-study.cjs"
popd
endlocal
