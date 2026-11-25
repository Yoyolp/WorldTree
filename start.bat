@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist node_modules (
  echo [1/3] Installing dependencies...
  call pnpm install
)
if not exist apps\web\dist (
  echo [2/3] Building frontend...
  call pnpm build
)
echo [3/3] Starting WorldTree at http://127.0.0.1:5174
call pnpm start
