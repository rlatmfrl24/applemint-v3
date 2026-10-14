@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
set "CODEX_NODE_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
if exist "%CODEX_NODE_BIN%\node.exe" set "PATH=%CODEX_NODE_BIN%;%PATH%"
call pnpm.cmd dev:local
set "LOCAL_EXIT_CODE=%ERRORLEVEL%"
popd
if not "%LOCAL_EXIT_CODE%"=="0" pause
exit /b %LOCAL_EXIT_CODE%
