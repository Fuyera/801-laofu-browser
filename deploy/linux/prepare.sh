#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
[ "$(node -p process.versions.node)" = "22.23.2" ] || { echo '请先安装 Node.js 22.23.2'; exit 1; }
npm ci
npm run build
npx playwright install chromium
npm test
printf '%s\n' '系统图形库与沙箱依赖应由管理员按 Playwright 官方文档安装；必须继续执行 Linux 实际浏览器验收。'
