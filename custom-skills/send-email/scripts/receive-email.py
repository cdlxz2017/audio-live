#!/usr/bin/env python3
"""
receive-email: 读取 QQ 邮箱收件箱
用法:
  python3 receive-email.py                      # 默认读最新10封
  python3 receive-email.py --count 20           # 读最新20封
  python3 receive-email.py --unread             # 只读未读邮件
  python3 receive-email.py --subject "测试"      # 按主题搜索
  python3 receive-email.py --from "qq.com"       # 按发件人搜索
"""

import imaplib
import email
from email.header import decode_header
import argparse
import sys
import datetime

# ============ 配置区 =====================================
IMAP_HOST = "imap.qq.com"
IMAP_PORT = 993
IMAP_USER = "cdlxz2017@qq.com"
IMAP_PASS = "egtlvgsyafpvcfde"  # QQ邮箱授权码
# =====================================================


def decode_str(s: str) -> str:
    """解码 email header 字符串"""
    if not s:
        return ""
    parts = decode_header(s)
    result = []
    for part, charset in parts:
        if isinstance(part, bytes):
            charset = charset or 'utf-8'
            try:
                result.append(part.decode(charset, errors='replace'))
            except Exception:
                result.append(part.decode('utf-8', errors='replace'))
        else:
            result.append(part)
    return ''.join(result)


def format_date(date_tuple) -> str:
    """格式化邮件日期"""
    if not date_tuple:
        return "未知日期"
    try:
        dt = datetime.datetime(*date_tuple[:6])
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return str(date_tuple)


def show_email(msg, idx: int, show_body: bool = True):
    """打印单封邮件概要"""
    subject = decode_str(msg.get('Subject', '(无主题)'))
    sender = decode_str(msg.get('From', ''))
    date = format_date(msg.get('Date'))
    to = decode_str(msg.get('To', ''))
    is_unread = 'UNREAD' in msg.get('FLAGS', '')

    print(f"{'●' if is_unread else '○'} [{idx}] 主题: {subject}")
    print(f"    发件人: {sender}")
    print(f"    收件人: {to}")
    print(f"    日期:   {date}")

    if show_body:
        body = extract_body(msg)
        if body:
            preview = body[:200].replace('\n', ' ')
            print(f"    摘要:   {preview}{'...' if len(body) > 200 else ''}")
    print()


def extract_body(msg) -> str:
    """提取邮件正文（优先纯文本）"""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get('Content-Disposition', ''))
            if ct == 'text/plain' and 'attachment' not in cd:
                charset = part.get_content_charset() or 'utf-8'
                try:
                    body = part.get_payload(decode=True).decode(charset, errors='replace')
                    break
                except Exception:
                    pass
            elif ct == 'text/html' and not body:
                charset = part.get_content_charset() or 'utf-8'
                try:
                    body = part.get_payload(decode=True).decode(charset, errors='replace')
                except Exception:
                    pass
    else:
        charset = msg.get_content_charset() or 'utf-8'
        try:
            body = msg.get_payload(decode=True).decode(charset, errors='replace')
        except Exception:
            pass
    return body.strip()


def list_emails(count: int = 10, unread_only: bool = False,
                subject_kw: str = None, sender_kw: str = None):
    """连接邮箱，列出邮件"""

    print(f"正在连接 {IMAP_HOST}:{IMAP_PORT}...", file=sys.stderr)
    try:
        mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        mail.login(IMAP_USER, IMAP_PASS)
        mail.select('INBOX')
    except Exception as e:
        print(f"连接失败: {e}", file=sys.stderr)
        sys.exit(1)

    # 构建搜索条件
    search_criteria = ['ALL']
    if unread_only:
        search_criteria = ['UNSEEN']
    if subject_kw:
        search_criteria.append(f'SUBJECT "{subject_kw}"')
    if sender_kw:
        search_criteria.append(f'FROM "{sender_kw}"')

    _, msg_ids = mail.search(None, *search_criteria)
    all_ids = msg_ids[0].split()
    total = len(all_ids)
    print(f"共 {total} 封邮件，显示最新 {min(count, total)} 封：\n", file=sys.stderr)

    if not all_ids:
        print("收件箱为空。")
        mail.logout()
        return

    # 取最新的 count 封
    show_ids = all_ids[-count:] if count < total else all_ids
    # 倒序显示（最新的在前）
    for i, mid in enumerate(reversed(show_ids), 1):
        _, data = mail.fetch(mid, '(FLAGS BODY.PEEK[HEADER.FIELDS (Subject From Date To)])')
        raw_headers = data[0][1]
        msg = email.message_from_bytes(raw_headers)
        _, data2 = mail.fetch(mid, '(FLAGS)')
        flags_data = data2[0]
        # 提取 flags
        flags_str = ''
        try:
            flags_str = flags_data[0].decode()
        except Exception:
            pass
        is_unread = b'UNSEEN' in flags_data or b'\\Seen' not in flags_data

        subject = decode_str(msg.get('Subject', '(无主题)'))
        sender = decode_str(msg.get('From', ''))
        date_str = format_date(msg.get('Date'))
        to = decode_str(msg.get('To', ''))

        print(f"{'●' if b'\\Seen' not in flags_data else '○'} [{total - total + i}] 主题: {subject}")
        print(f"    发件人: {sender}")
        print(f"    日期:   {date_str}")
        print()

    mail.logout()


def main():
    parser = argparse.ArgumentParser(description="读取 QQ 邮箱收件箱")
    parser.add_argument('--count', type=int, default=10, help='显示邮件数量（默认10）')
    parser.add_argument('--unread', action='store_true', help='只显示未读邮件')
    parser.add_argument('--subject', type=str, help='按主题关键词搜索')
    parser.add_argument('--from', dest='sender', type=str, help='按发件人搜索')

    args = parser.parse_args()

    list_emails(
        count=args.count,
        unread_only=args.unread,
        subject_kw=args.subject,
        sender_kw=args.sender
    )


if __name__ == '__main__':
    main()
