# 世界树 · 一键启动（生产模式）
# 首次运行会自动安装依赖、构建前端
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path 'node_modules')) {
    Write-Host '[1/3] 安装依赖…' -ForegroundColor Cyan
    pnpm install
}
if (-not (Test-Path 'apps\web\dist')) {
    Write-Host '[2/3] 构建前端…' -ForegroundColor Cyan
    pnpm build
}
Write-Host '[3/3] 启动世界树 → http://127.0.0.1:5174' -ForegroundColor Green
pnpm start
