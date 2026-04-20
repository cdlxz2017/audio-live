#!/bin/bash
# 同步 Trace Chain 监控状态到副脑 Thread
STATE_FILE="/tmp/trace_chain_state.json"
THREAD_ID="29c64b9d-9e78-43be-8d98-6dc0bcb62e14"
API="http://localhost:54321"

if [ ! -f "$STATE_FILE" ]; then
    exit 0
fi

TOTAL=$(grep '"total"' "$STATE_FILE" | cut -d'"' -f4)
SUMMARIZED=$(grep '"summarized"' "$STATE_FILE" | cut -d'"' -f4)
OUTBOX=$(grep '"outbox"' "$STATE_FILE" | cut -d'"' -f4)
PERSONAL=$(grep '"personal"' "$STATE_FILE" | cut -d'"' -f4)
NEO4J=$(grep '"neo4j"' "$STATE_FILE" | cut -d'"' -f4)
STUCK=$(grep '"stuckCount"' "$STATE_FILE" | cut -d':' -f2 | tr -d ' ,')
TS=$(grep '"ts"' "$STATE_FILE" | cut -d'"' -f4)

# 通过 API 更新 verification 阶段
curl -s -X PATCH "${API}/threads/${THREAD_ID}/stage" \
  -H "Content-Type: application/json" \
  -d "{\"stage\": \"verification\", \"content\": {
    \"notes\": \"后台监控每10分钟检查，副脑自动同步状态\",
    \"current_state\": {
      \"total\": ${TOTAL:-0},
      \"summarized\": ${SUMMARIZED:-0},
      \"outbox_queued\": ${OUTBOX:-0},
      \"personal_stored\": ${PERSONAL:-0},
      \"neo4j_synced\": ${NEO4J:-0},
      \"stuck_count\": ${STUCK:-0},
      \"last_check\": \"${TS}\",
      \"note\": \"stuck为false positive（VALUABLE_TYPES外的摘要以neo4j_synced为终点，非真卡住）\"
    }
  }}" > /dev/null 2>&1
