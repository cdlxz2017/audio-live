#!/bin/bash
# 同步自学习记忆引擎监控状态到副脑 Thread
THREAD_ID="b8bec86e-fcec-4a14-b43a-9c12fb5fd416"
API="http://localhost:54321"
STATE_FILE="/tmp/learning-engine-state.json"

cd /home/ai/.openclaw/workspace/memory-system || exit 1

# 运行监控
OUTPUT=$(node scripts/learning-engine-monitor.js 2>/dev/null)

# 解析关键指标（简化逻辑，直接提取数字）
LEARNED_FILES=$(echo "$OUTPUT" | grep "文件数" | grep -oE '[0-9]+' | head -1)
LEARNED_SUMMARIES=$(echo "$OUTPUT" | grep -E "learned类型" | grep -oE '[0-9]+' | head -1)
FB_LINE=$(echo "$OUTPUT" | grep "反馈" | head -1)
FEEDBACK_POS=$(echo "$FB_LINE" | sed 's/.*正向 //' | sed 's/ .*//')
FEEDBACK_NEG=$(echo "$FB_LINE" | sed 's/.*负向 //' | sed 's/ .*//')
RESEARCH_TRIG=$(echo "$OUTPUT" | grep -E "触发研究次数" | grep -oE '[0-9]+' | head -1)
RESEARCH_OK=$(echo "$OUTPUT" | grep -E "成功次数" | grep -oE '[0-9]+' | head -1)
HEALTH=$(echo "$OUTPUT" | grep "健康度评分" | grep -oE '[0-9]+/100' | head -1)

# 如果没有有效数据，退出
if [ -z "$LEARNED_FILES" ]; then
    exit 0
fi

echo "{
  \"learned_files\": ${LEARNED_FILES:-0},
  \"learned_summaries\": ${LEARNED_SUMMARIES:-0},
  \"feedback_positive_7d\": ${FEEDBACK_POS:-0},
  \"feedback_negative_7d\": ${FEEDBACK_NEG:-0},
  \"research_triggers\": ${RESEARCH_TRIG:-0},
  \"research_success\": ${RESEARCH_OK:-0},
  \"health\": \"${HEALTH:-未知}\",
  \"updated_at\": \"$(date -Iseconds)\"
}" > "$STATE_FILE"

# 同步到副脑
curl -s -X PATCH "${API}/threads/${THREAD_ID}/stage" \
  -H "Content-Type: application/json" \
  -d "{\"stage\": \"verification\", \"content\": {
    \"current_state\": {
      \"learned_files\": ${LEARNED_FILES:-0},
      \"learned_summaries\": ${LEARNED_SUMMARIES:-0},
      \"feedback_positive_7d\": ${FEEDBACK_POS:-0},
      \"feedback_negative_7d\": ${FEEDBACK_NEG:-0},
      \"research_triggers\": ${RESEARCH_TRIG:-0},
      \"research_success\": ${RESEARCH_OK:-0},
      \"health\": \"${HEALTH:-未知}\",
      \"last_sync\": \"$(date '+%Y-%m-%d %H:%M')\"
    }
  }}" > /dev/null 2>&1
