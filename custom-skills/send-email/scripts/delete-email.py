#!/usr/bin/env python3
"""
delete-email: 批量移动或删除邮件
用法:
  python3 delete-email.py --move-trash "subject contains xxx"
  python3 delete-email.py --delete "from xxx"
  python3 delete-email.py --list-folders
"""

import imaplib
import argparse
import sys

# ============ 配置区 =====================================
IMAP_HOST = "imap.qq.com"
IMAP_PORT = 993
IMAP_USER = "cdlxz2017@qq.com"
IMAP_PASS = "egtlvgsyafpvcfde"
# =====================================================

imap = None

def connect():
    global imap
    imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    imap.login(IMAP_USER, IMAP_PASS)
    print(f"已连接 {IMAP_HOST}", file=sys.stderr)


def list_folders():
    connect()
    _, folders = imap.list()
    for f in folders:
        print(f.decode())


def search_and_delete(search_type, value, to_trash=True):
    connect()
    imap.select('INBOX')

    if search_type == 'subject':
        _, data = imap.search(None, f'SUBJECT "{value}"')
    elif search_type == 'from':
        _, data = imap.search(None, f'FROM "{value}"')
    elif search_type == 'id':
        ids = [v.strip() for v in value.split(',')]
        data = [b','.join([f'{i.strip()}'.encode() for i in ids])]
    else:
        print(f"未知搜索类型: {search_type}", file=sys.stderr)
        return

    msg_ids = data[0].split()
    if not msg_ids:
        print("未找到匹配的邮件")
        imap.logout()
        return

    print(f"找到 {len(msg_ids)} 封邮件:", file=sys.stderr)
    for mid in msg_ids:
        _, msg_data = imap.fetch(mid, '(SUBJECT FROM)')
        print(f"  [{mid.decode()}] {msg_data[0].decode()}", file=sys.stderr)

    # 拼接为逗号分隔的字符串
    mid_str = ','.join(m.decode() for m in msg_ids)

    if to_trash:
        # 移动到垃圾箱
        print("移动到 [Trash]...", file=sys.stderr)
        imap.copy(mid_str, 'Trash')
        imap.store(mid_str, '+FLAGS', '(\\Deleted)')
    else:
        print("直接删除...", file=sys.stderr)
        imap.store(mid_str, '+FLAGS', '(\\Deleted)')

    imap.expunge()
    imap.logout()
    print(f"✅ 完成，共处理 {len(msg_ids)} 封", file=sys.stderr)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--list-folders', action='store_true', help='列出所有文件夹')
    parser.add_argument('--subject', type=str, help='按主题匹配删除')
    parser.add_argument('--from', dest='sender', type=str, help='按发件人匹配删除')
    parser.add_argument('--id', type=str, help='按邮件ID删除，逗号分隔')
    parser.add_argument('--no-trash', action='store_true', help='跳过垃圾箱，直接删除')

    args = parser.parse_args()

    if args.list_folders:
        list_folders()
    elif args.subject:
        search_and_delete('subject', args.subject, to_trash=not args.no_trash)
    elif args.sender:
        search_and_delete('from', args.sender, to_trash=not args.no_trash)
    elif args.id:
        search_and_delete('id', args.id, to_trash=not args.no_trash)
    else:
        parser.print_help()
