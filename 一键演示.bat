@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title SOP 流程资产线上化平台 · 本地演示

echo.
echo   ============================================================
echo    SOP 流程资产线上化平台 · 售前演示
echo   ------------------------------------------------------------
echo    零环境依赖：不需要 Python / Node / Java，也不需要联网
echo   ============================================================
echo.

set "SINGLE=%~dp0dist\SOP流程资产平台.html"

if exist "%SINGLE%" (
  echo   正在打开单文件版（自包含，断网可用）...
  echo   %SINGLE%
  start "" "%SINGLE%"
  echo.
  echo   已打开。若浏览器未弹出，请手动双击：
  echo   dist\SOP流程资产平台.html
  echo.
  echo   提示：把这个 HTML 直接发给同事 / 微信 / 邮件，对方双击即可打开。
  pause
  exit /b 0
)

echo   未找到单文件版，改为打开多文件源码版 index.html
echo   （多文件版用于二次开发；给客户演示请用单文件版）
echo.
start "" "%~dp0index.html"
echo.
echo   若页面空白，说明浏览器拦截了本地脚本，请先运行：
echo       python tools\build_single_file.py
echo   生成 dist\SOP流程资产平台.html
echo.
pause
