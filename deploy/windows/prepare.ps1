$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw '目标为 Windows 11 x86_64，其他架构待验' }
if ((node -p 'process.versions.node') -ne '22.23.2') { throw '先安装 Node.js 22.23.2 Windows x64 版本' }
npm ci
if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
npm run build
if ($LASTEXITCODE -ne 0) { throw '构建失败' }
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw '浏览器安装失败' }
npm test
if ($LASTEXITCODE -ne 0) { throw '测试失败' }
Write-Host '源码和本地检查已完成。还须在 Windows 运行工具、图文、接手和故障验收；不能据此声称 Windows 全面通过。'
