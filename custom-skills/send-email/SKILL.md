# send-email Skill

> 通过 QQ 邮箱发送和读取邮件，所有发出的邮件自动追加落款 `—— 天道AI`

## 发送邮件

### 命令行调用

```bash
python3 /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-email.py \
  --to "收件人@example.com" \
  --subject "邮件主题" \
  --body "邮件正文（纯文本）" \
  [--html] \
  [--attach /path/to/file1] \
  [--attach /path/to/file2]
```

### 可选参数

| 参数 | 说明 |
|------|------|
| `--to` | 收件人地址（必填） |
| `--subject` | 邮件主题（必填） |
| `--body` | 邮件正文（必填） |
| `--html` | 正文以HTML格式发送（可选） |
| `--attach` | 附件路径，可多次使用添加多个附件 |
| `--dry-run` | 仅打印邮件内容，不发送 |

### 示例

**纯文本 + 单附件：**
```bash
python3 .../send-email.py \
  --to "cdlxz2017@qq.com" \
  --subject "项目报告" \
  --body "请查收附件中的项目报告。" \
  --attach /home/ai/report.pdf
```

**HTML 邮件 + 多附件：**
```bash
python3 .../send-email.py \
  --to "user@example.com" \
  --subject "月度汇总" \
  --body "<h2>本月数据汇总</h2><p>详见附件。</p>" \
  --html \
  --attach /home/ai/data.xlsx \
  --attach /home/ai/chart.png
```

---

## 读取邮件

### 命令行调用

```bash
python3 /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/receive-email.py
```

### 参数

| 参数 | 说明 |
|------|------|
| `--count N` | 显示最新 N 封（默认10） |
| `--unread` | 只显示未读邮件 |
| `--subject 关键词` | 按主题搜索 |
| `--from 发件人` | 按发件人搜索 |

### 示例

```bash
# 读最新20封
receive-email.py --count 20

# 只看未读
receive-email.py --unread

# 搜索含"项目"主题的邮件
receive-email.py --subject "项目"

# 搜索来自QQ的邮件
receive-email.py --from "qq.com"
```

---

## 配置信息

| 项目 | 值 |
|------|----|
| 发件人/收件人 | cdlxz2017@qq.com |
| SMTP | smtp.qq.com:587 (TLS) |
| IMAP | imap.qq.com:993 (SSL) |
| 授权码 | 已配置在脚本中 |

## 技术说明

- 使用 Python 标准库，无需安装额外依赖
- 附件中文文件名已做 RFC 2047 编码处理
- 支持 HTML 和纯文本两种正文格式
- 读取邮件默认显示发件人、主题、日期和正文摘要（前200字）
