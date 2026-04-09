# SOP-EMAIL - 发送邮件标准流程

> 快速参考：发邮件就用这个流程
> 最后更新：2026-04-05

---

## 一、准备工作

**首次使用（仅一次）**：已由 AI 完成配置，无需操作。

**每次发邮件前确认**：
- 收件人地址
- 邮件主题
- 正文内容
- 附件路径（可选）

---

## 二、标准发送命令

### 2.1 纯文本邮件

```bash
python3 /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-email.py \
  --to "收件人@example.com" \
  --subject "邮件主题" \
  --body "邮件正文内容"
```

### 2.2 带附件（单/多附件）

```bash
python3 /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-email.py \
  --to "收件人@example.com" \
  --subject "邮件主题" \
  --body "请查收附件。" \
  --attach /path/to/file1 \
  --attach /path/to/file2
```

### 2.3 HTML 正文邮件

```bash
python3 /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-email.py \
  --to "收件人@example.com" \
  --subject "HTML 邮件" \
  --body "<h1>标题</h1><p>这是 <b>加粗</b> 内容。</p><img src='cid:image1'>" \
  --html \
  --attach /path/to/image.png
```

### 2.4 预览模式（不发送）

加 `--dry-run` 参数，只打印邮件内容，不实际发送：

```bash
python3 .../send-email.py \
  --to "test@example.com" \
  --subject "预览" \
  --body "正文" \
  --dry-run
```

---

## 三、参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `--to` | ✅ | 收件人邮箱地址 |
| `--subject` | ✅ | 邮件主题（建议简短明确） |
| `--body` | ✅ | 邮件正文 |
| `--html` | ❌ | 加此参数表示正文是 HTML 格式 |
| `--attach` | ❌ | 附件路径，可重复多次添加多个附件 |

---

## 四、配置信息

| 项目 | 值 |
|------|----|
| 发件人 | cdlxz2017@qq.com |
| SMTP 服务器 | smtp.qq.com |
| SMTP 端口 | 587 (TLS) |
| 授权码 | 已配置在脚本中 |

---

## 五、注意事项

1. **附件路径**使用绝对路径，避免相对路径问题
2. **HTML 邮件**中图片若想内嵌显示需用 CID（Content-ID），当前版本以附件形式发送
3. **大文件附件**QQ 邮箱限制约 50MB，实际建议不超过 30MB
4. 如需修改发件人，编辑脚本顶部 `DEFAULT_FROM` 和 `SMTP_USER`

---

## 六、读取邮件

```bash
# 读最新10封
python3 /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/receive-email.py

# 读最新20封
python3 .../receive-email.py --count 20

# 只看未读
python3 .../receive-email.py --unread

# 按主题搜索
python3 .../receive-email.py --subject "项目"

# 按发件人搜索
python3 .../receive-email.py --from "qq.com"
```

## 七、快速复制模板

**报告类：**
```bash
python3 .../send-email.py \
  --to "收件人@example.com" \
  --subject "【日/周/月】报告标题" \
  --body "请查收附件中的报告，有问题请随时联系。" \
  --attach /home/ai/report.pdf
```

**通知类：**
```bash
python3 .../send-email.py \
  --to "收件人@example.com" \
  --subject "【通知】标题" \
  --body "<b>重要通知：</b>正文内容"
  --html
```
