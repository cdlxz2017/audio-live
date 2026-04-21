#!/bin/bash

# 记忆系统健康检查
REPORT=$(SUPPRESS_MEMORIES_ALERT=true SUPPRESS_CM_ALERT=true node /home/ai/.openclaw/workspace/memory-system/scripts/health-check.js 2>&1)
MEMORY_EXIT=$?

# 审计系统监控
AUDIT_REPORT=$(node /home/ai/.openclaw/workspace/audit-scripts/audit-monitor.js 2>&1)
AUDIT_EXIT=$?

EMAIL_BODY="记忆系统 + 审计系统健康检查报告（自动每4小时）

## 记忆系统
${REPORT}

## 审计系统
${AUDIT_REPORT}

---
此邮件由 OpenClaw 自动发送"

# 邮件发送最多等30秒，防止SMTP挂起拖死整个健康检查
timeout 30 python3 /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-email.py \
  --to cdlxz2017@qq.com \
  --subject "[健康检查] 记忆+审计 $(date '+%m/%d %H:%M')" \
  --body "${EMAIL_BODY}" \
  || echo "[WARNING] 邮件发送超时或失败"

# 任一检查失败则整体失败
exit $((MEMORY_EXIT || AUDIT_EXIT))
