@echo off
set "LAOFU_ROOT=%~dp0.."
if exist "%LAOFU_ROOT%\browsers" set "PLAYWRIGHT_BROWSERS_PATH=%LAOFU_ROOT%\browsers"
if exist "%LAOFU_ROOT%\node\node.exe" (
  "%LAOFU_ROOT%\node\node.exe" "%LAOFU_ROOT%\dist\cli.js" %*
) else (
  node "%LAOFU_ROOT%\dist\cli.js" %*
)
