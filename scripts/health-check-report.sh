#!/bin/bash
REPORT=$(node /home/ai/.openclaw/workspace/memory-system/scripts/health-check.js 2>&1)
EXIT_CODE=$?

EMAIL_BODY="记忆系统健康检查报告（自动每4小时）

${REPORT}

---
此邮件由 OpenClaw 自动发送"

python3 /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-email.py \
  --to cdlxz2017@qq.com \
  --subject "[记忆系统] 健康检查报告 $(date '+%m/%d %H:%M')" \
  --body "${EMAIL_BODY}"

exit $EXIT_CODE
