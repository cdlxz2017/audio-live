# send-email

## 基本信息
- **类型**：通信工具
- **路径**：`custom-skills/send-email/`
- **来源**：自制
- **状态**：✅ 正常

## 能力
- 发送邮件（纯文本/HTML）
- 支持多附件
- 读取邮件（最新/未读/搜索）

## 配置
| 项 | 值 |
|----|-----|
| 邮箱 | cdlxz2017@qq.com |
| SMTP | smtp.qq.com:587 |
| IMAP | imap.qq.com:993 |

## 调用
```bash
# 发送
python3 .../send-email.py --to "x@example.com" --subject "主题" --body "正文" [--attach 路径]

# 读取
python3 .../receive-email.py [--count N] [--unread] [--subject 关键词]
```

## SOP 关联
- SOP: `SOP-EMAIL.md`
- 发出邮件自动追加落款：—— 天道AI
- 属于 🔴 红灯操作，必须主人确认

## 历史使用
| 日期 | 任务 | 结果 |
|------|------|------|
| 2026-04-19 | 记忆系统告警邮件通知 | ✅ 成功 |
