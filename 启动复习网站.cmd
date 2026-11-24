@echo off
setlocal
chcp 65001 >nul
title C System Study - Close this window to stop
pushd "%~dp0" >nul 2>&1
if errorlevel 1 goto failed
set "C_STUDY_NODE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined C_STUDY_NODE set "C_STUDY_NODE=%%I"
if not defined C_STUDY_NODE if exist "%ProgramFiles%\nodejs\node.exe" set "C_STUDY_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined C_STUDY_NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "C_STUDY_NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined C_STUDY_NODE goto fallback
"%C_STUDY_NODE%" "%~dp0server.cjs" --open --terminal-bound
set "C_STUDY_RC=%ERRORLEVEL%"
popd >nul 2>&1
if not "%C_STUDY_RC%"=="0" goto failed
exit /b 0
:fallback
echo Node.js was not found. Opening offline index.html directly...
if exist "%~dp0复习网站\index.html" (
  if not "%C_STUDY_NO_OPEN%"=="1" start "" "%~dp0复习网站\index.html"
  popd >nul 2>&1
  exit /b 0
)
popd >nul 2>&1
echo Could not find website index.html.
:failed
echo.
echo The website could not start. Please keep this error message.
pause
exit /b 1
