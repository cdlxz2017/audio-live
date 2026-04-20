#!/bin/bash
# Trace Chain 监控脚本（无阻塞版）
# 每10分钟运行一次，有新数据时通过 Gateway API 推送到 Telegram

WORKDIR="/home/ai/.openclaw/workspace/memory-system"
STATE_FILE="/tmp/trace-chain-last-state.txt"
LOG_FILE="/tmp/trace-chain-monitor.log"

cd "$WORKDIR" || exit 1

# 运行审计脚本，捕获输出（30秒超时）
OUTPUT=$(timeout 30 node scripts/trace-chain-audit.js 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$OUTPUT" ]; then
    echo "[$(date)] Audit failed or timeout" >> "$LOG_FILE"
    exit 1
fi

# 解析关键指标
TOTAL=$(echo "$OUTPUT" | grep "总追踪数:" | awk '{print $2}')
SUMMARIZED=$(echo "$OUTPUT" | grep "已摘要:" | awk '{print $2}')
OUTBOX=$(echo "$OUTPUT" | grep "已入 outbox:" | awk -F'[/：]' '{print $2}' | tr -d ' ')
PERSONAL=$(echo "$OUTPUT" | grep "已入 personal:" | awk -F'[/：]' '{print $2}' | tr -d ' ')
NEO4J=$(echo "$OUTPUT" | grep "已同步 Neo4j:" | awk -F'[/：]' '{print $2}' | tr -d ' ')

# 读取上次状态
LAST_TOTAL=""
[ -f "$STATE_FILE" ] && LAST_TOTAL=$(cat "$STATE_FILE")

# 如果有新记录，发送到 Telegram
if [ -n "$TOTAL" ] && [ "$TOTAL" != "$LAST_TOTAL" ]; then
    NEW=$((TOTAL - LAST_TOTAL))
    MSG="【Trace Chain 监控】
时间：$(date '+%Y-%m-%d %H:%M')
总追踪：${TOTAL} 条 (+${NEW} 新)
✅ summarized：${SUMMARIZED}
✅ outbox：${OUTBOX}
✅ personal：${PERSONAL}
✅ neo4j：${NEO4J}"
    
    # 通过 Gateway API 发送 Telegram 消息
    curl -s -X POST "http://localhost:18789/api/message/send" \
        -H "Content-Type: application/json" \
        -d "{\"channel\":\"telegram\",\"target\":\"8707975769\",\"message\":$(echo "$MSG" | jq -Rs .)}" \
        2>/dev/null
    
    echo "$TOTAL" > "$STATE_FILE"
    echo "[$(date)] Sent: total=$TOTAL new=$NEW" >> "$LOG_FILE"
else
    echo "[$(date)] No change (total=$TOTAL)" >> "$LOG_FILE"
fi
