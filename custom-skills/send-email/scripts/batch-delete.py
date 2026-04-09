#!/usr/bin/env python3
"""精准删除指定序号的邮件"""
import imaplib
import sys

IMAP_HOST = "imap.qq.com"
IMAP_PORT = 993
IMAP_USER = "cdlxz2017@qq.com"
IMAP_PASS = "egtlvgsyafpvcfde"

DELETE_SEQ = [6, 9, 10, 11, 18, 1, 24, 2, 3, 4]

mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
mail.login(IMAP_USER, IMAP_PASS)
mail.select('INBOX')

_, data = mail.search(None, 'ALL')
all_ids = data[0].split()
total = len(all_ids)
print(f"收件箱共 {total} 封")

# 序列号 → 对应位置的消息ID
seq_to_mid = {i+1: mid for i, mid in enumerate(all_ids)}

deleted = []
for seq in sorted(DELETE_SEQ):
    if seq in seq_to_mid:
        mid = seq_to_mid[seq]
        mail.store(mid, '+FLAGS', '(\\Deleted)')
        deleted.append(seq)
        print(f"  序号{seq} → UID {mid.decode()} [已删除]")

if deleted:
    mail.expunge()
    print(f"✅ 共删除 {len(deleted)} 封")
else:
    print("没有找到可删除的邮件")

mail.logout()
