#!/bin/bash
# =============================================================================
# 洞鉴院 Plan A+C 修复回滚脚本
# 用途：将洞鉴院前端 auth.js / router/index.js + 后端 auth.js 回滚到修复前状态
# 使用：bash rollback-dongjian.sh
# =============================================================================

set -e

FRONTEND=/home/ai/projects/tiandao_dongjianyuan/frontend/src
BACKEND=/home/ai/projects/tiandao_dongjianyuan/backend/src
SNAPSHOT=20260423

echo "━━━ 洞鉴院 Plan A+C 回滚 ━━━"

# 1. 恢复前端 auth.js（Plan C JWT过期检查）
if [ -f "$FRONTEND/stores/auth.js.bak.$SNAPSHOT" ]; then
  cp "$FRONTEND/stores/auth.js.bak.$SNAPSHOT" "$FRONTEND/stores/auth.js"
  echo "✅ auth.js 已恢复"
else
  echo "⚠️  未找到备份: auth.js.bak.$SNAPSHOT"
fi

# 2. 恢复前端 router/index.js（Plan A 路由守卫）
if [ -f "$FRONTEND/router/index.js.bak.$SNAPSHOT" ]; then
  cp "$FRONTEND/router/index.js.bak.$SNAPSHOT" "$FRONTEND/router/index.js"
  echo "✅ router/index.js 已恢复"
else
  echo "⚠️  未找到备份: router/index.js.bak.$SNAPSHOT"
fi

# 3. 恢复前端 api/index.js（移除 me 接口）
if [ -f "$FRONTEND/api/index.js.bak.$SNAPSHOT" ]; then
  cp "$FRONTEND/api/index.js.bak.$SNAPSHOT" "$FRONTEND/api/index.js"
  echo "✅ api/index.js 已恢复"
else
  echo "⚠️  未找到备份"
fi

# 4. 恢复后端 auth.js（移除 /auth/me）
if [ -f "$BACKEND/routes/auth.js.bak.$SNAPSHOT" ]; then
  cp "$BACKEND/routes/auth.js.bak.$SNAPSHOT" "$BACKEND/routes/auth.js"
  echo "✅ backend auth.js 已恢复"
else
  echo "⚠️  未找到备份: backend auth.js.bak.$SNAPSHOT"
fi

# 5. 重新构建前端
echo ""
echo "🔨 重新构建前端..."
cd /home/ai/projects/tiandao_dongjianyuan/frontend && npm run build 2>&1 | tail -5

# 6. 重启后端
echo ""
echo "🔄 重启后端..."
/home/ai/.npm-global/bin/pm2 restart dongjian-backend 2>&1 | tail -2

echo ""
echo "━━━ 回滚完成 ━━━"
echo "请清除浏览器 localStorage 后访问：http://100.89.109.20:3012/"
