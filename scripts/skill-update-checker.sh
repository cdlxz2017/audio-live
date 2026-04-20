#!/bin/bash
# Skill Update Checker — 每日检查已安装 skill 的最新版本
# 用法：bash skill-update-checker.sh

set -e

WORKSPACE="/home/ai/.openclaw/workspace"
REPORT_DIR="$WORKSPACE/memory/skill-updates"
DATE=$(date '+%Y-%m-%d')
REPORT_FILE="$REPORT_DIR/${DATE}.md"
SKILL_LIST=$(clawhub list 2>/dev/null)

# 创建报告目录
mkdir -p "$REPORT_DIR"

# 写入报告头
cat > "$REPORT_FILE" << EOF
# Skill 更新报告 — ${DATE}

生成时间：$(date '+%Y-%m-%d %H:%M:%S')

## 已安装 Skill 版本检查

EOF

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查每个 skill
echo "$SKILL_LIST" | while IFS= read -r line; do
  # 跳过空行和标题行
  [[ -z "$line" || "$line" =~ ^[[:space:]]*$ ]] && continue
  [[ "$line" =~ ^Skill ]] && continue

  # 解析 skill 名和版本（格式："name  version"）
  SLUG=$(echo "$line" | awk '{print $1}')
  LOCAL_VERSION=$(echo "$line" | awk '{print $2}')

  [[ -z "$SLUG" ]] && continue

  echo "正在检查: $SLUG ..."

  # 获取远程最新版本
  REMOTE_INFO=$(clawhub inspect "$SLUG" 2>/dev/null | grep -E "^Latest:|^Updated:")
  REMOTE_VERSION=$(echo "$REMOTE_INFO" | grep "^Latest:" | awk '{print $2}')
  REMOTE_UPDATED=$(echo "$REMOTE_INFO" | grep "^Updated:" | awk '{print $2}')

  if [[ -z "$REMOTE_VERSION" ]]; then
    echo "  ⚠️ 无法获取 $SLUG 的远程版本信息"
    echo "| $SLUG | $LOCAL_VERSION | 未知 | — | ⚠️ 无法检查 |" >> "$REPORT_FILE"
    continue
  fi

  if [[ "$LOCAL_VERSION" == "$REMOTE_VERSION" ]]; then
    STATUS="✅ 最新"
    ICON="✅"
    echo -e "${GREEN}  ✅ $SLUG: $LOCAL_VERSION (已是最新)${NC}"
    echo "| \`$SLUG\` | $LOCAL_VERSION | $REMOTE_VERSION | $REMOTE_UPDATED | $STATUS |" >> "$REPORT_FILE"
  else
    STATUS="🆕 有更新"
    ICON="🆕"
    echo -e "${YELLOW}  🆕 $SLUG: $LOCAL_VERSION → $REMOTE_VERSION${NC}"
    echo "| \`$SLUG\` | $LOCAL_VERSION | $REMOTE_VERSION | $REMOTE_UPDATED | $STATUS |" >> "$REPORT_FILE"
  fi
done

# 写入报告尾
UPDATED_COUNT=$(grep -c "🆕 有更新" "$REPORT_FILE" 2>/dev/null || echo 0)

cat >> "$REPORT_FILE" << EOF

## 统计

- 有更新：${UPDATED_COUNT} 个
- 已是最新：$(grep -c "✅ 最新" "$REPORT_FILE" 2>/dev/null || echo "0") 个

EOF

if [[ "$UPDATED_COUNT" -gt 0 ]]; then
  echo "" >> "$REPORT_FILE"
  echo '## 决策' >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo '回复数字选择：' >> "$REPORT_FILE"
  echo '1 — 更新全部' >> "$REPORT_FILE"
  echo '2 — 逐个确认（输入编号，如 3,5,7）' >> "$REPORT_FILE"
  echo '0 — 全部跳过' >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo '> 回复后玄枢将按你的选择执行更新（带快照保护）' >> "$REPORT_FILE"
fi

# 发送邮件通知
python3 "$WORKSPACE/custom-skills/send-email/scripts/send-email.py" \
  --to cdlxz2017@qq.com \
  --subject "[Skill更新] $(date '+%m/%d %H:%M') — ${UPDATED_COUNT} 个可更新" \
  --body "Skill 更新报告已生成：${REPORT_FILE}

有更新：${UPDATED_COUNT} 个

$(cat "$REPORT_FILE")" 2>/dev/null

echo ""
echo "✅ 报告已保存：$REPORT_FILE"
echo "📧 通知邮件已发送"
