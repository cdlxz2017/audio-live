#!/usr/bin/env python3
"""
send-email: 发送带附件的邮件
用法:
  python3 send-email.py --to to@example.com --subject "主题" --body "正文" --attach file1.pdf --attach file2.jpg
  python3 send-email.py --to to@example.com --subject "HTML邮件" --body "<h1>HTML正文</h1>" --html
"""

import smtplib
import argparse
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
import sys


# ============ 配置区（可按需修改默认发件人）============
DEFAULT_FROM = "cdlxz2017@qq.com"
SMTP_HOST = "smtp.qq.com"
SMTP_PORT = 587
SMTP_USER = "cdlxz2017@qq.com"
SMTP_PASS = "egtlvgsyafpvcfde"  # QQ邮箱授权码
EMAIL_SIGNATURE = "\n\n—— 天道AI"
# =====================================================


def build_message(to_addr: str, subject: str, body: str, html: bool, attachments: list[str]) -> MIMEMultipart:
    msg = MIMEMultipart()
    msg['From'] = DEFAULT_FROM
    msg['To'] = to_addr
    msg['Subject'] = subject

    # 正文（自动追加落款）
    content_type = 'html' if html else 'plain'
    signed_body = body + EMAIL_SIGNATURE
    msg.attach(MIMEText(signed_body, content_type, 'utf-8'))

    # 附件
    for filepath in attachments:
        try:
            with open(filepath, 'rb') as f:
                part = MIMEBase('application', 'octet-stream')
                part.set_payload(f.read())
                encoders.encode_base64(part)
                filename = filepath.split('/')[-1]
                # 中文文件名处理
                from email.header import Header
                part.add_header('Content-Disposition', 'attachment',
                                filename=('utf-8', '', filename))
                msg.attach(part)
        except Exception as e:
            print(f"[警告] 附件读取失败 {filepath}: {e}", file=sys.stderr)

    return msg


def send(to_addr: str, subject: str, body: str,
         html: bool = False, attachments: list[str] = None,
         dry_run: bool = False):
    attachments = attachments or []

    msg = build_message(to_addr, subject, body, html, attachments)

    if dry_run:
        print(f"[Dry Run] 发件人: {DEFAULT_FROM}")
        print(f"[Dry Run] 收件人: {to_addr}")
        print(f"[Dry Run] 主题: {subject}")
        print(f"[Dry Run] 附件数: {len(attachments)}")
        for a in attachments:
            print(f"[Dry Run]   - {a}")
        return

    print(f"正在连接 {SMTP_HOST}:{SMTP_PORT}...")
    server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30)
    server.starttls()
    server.login(SMTP_USER, SMTP_PASS)
    server.send_message(msg)
    server.quit()
    print(f"✅ 邮件已发送至 {to_addr}")


def main():
    parser = argparse.ArgumentParser(description="发送带附件的邮件")
    parser.add_argument('--to', required=True, help='收件人地址')
    parser.add_argument('--subject', required=True, help='邮件主题')
    parser.add_argument('--body', required=True, help='邮件正文')
    parser.add_argument('--html', action='store_true', help='正文以HTML格式发送')
    parser.add_argument('--attach', action='append', default=[], dest='attachments',
                        help='附件路径，可多次使用（--attach f1 --attach f2）')
    parser.add_argument('--dry-run', action='store_true', help='仅打印邮件内容，不发送')

    args = parser.parse_args()

    send(
        to_addr=args.to,
        subject=args.subject,
        body=args.body,
        html=args.html,
        attachments=args.attachments,
        dry_run=args.dry_run
    )


if __name__ == '__main__':
    main()
