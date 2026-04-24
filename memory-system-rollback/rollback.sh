#!/bin/bash
# =============================================================================
# 一键回滚脚本 — memory-system-rollback
# 用途：将 memory-system 关键组件回滚到 2026-04-22 22:30 快照状态
# 使用：bash rollback.sh
# =============================================================================

set -e

SNAPSHOT_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP=$(ls "$SNAPSHOT_DIR"/*.js.* 2>/dev/null | head -1 | sed 's/.*\.\([0-9_]\{15\}\)$/\1/')
SCRIPTS_DIR="/home/ai/.openclaw/workspace/memory-system/scripts"

if [ -z "$TIMESTAMP" ]; then
  echo "❌ 未找到快照文件，请检查 $SNAPSHOT_DIR"
  exit 1
fi

echo "━━━ memory-system 一键回滚 ━━━"
echo "快照时间: $TIMESTAMP"
echo ""

# 1. 恢复关键脚本
echo "📦 恢复关键脚本..."
for file in session-recall outbox-writer embedder config graph-linker circuit-breaker; do
  SRC="$SNAPSHOT_DIR/${file}.js.$TIMESTAMP"
  DST="$SCRIPTS_DIR/${file}.js"
  if [ -f "$SRC" ]; then
    cp "$SRC" "$DST"
    echo "  ✅ $file.js"
  else
    echo "  ⚠️  未找到快照: $SRC"
  fi
done

# 2. 重启相关 PM2 进程
echo ""
echo "🔄 重启相关 PM2 进程..."
for proc in session-summary-extractor outbox-writer graph-linker; do
  /home/ai/.npm-global/bin/pm2 restart "$proc" 2>/dev/null && echo "  ✅ $proc 重启成功" || echo "  ⚠️  $proc 重启失败"
done

echo ""
echo "━━━ 回滚完成 ━━━"
echo "如需确认，请运行："
echo "  /home/ai/.npm-global/bin/pm2 status | grep -E 'session-summary|outbox|graph-linker'"
echo "  diff $(ls $SNAPSHOT_DIR/*.js.$TIMESTAMP | head -1) $SCRIPTS_DIR/session-recall.js"
