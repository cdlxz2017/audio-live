#!/usr/bin/env python3
"""
voice_cli.py - 4G语音通讯系统 v2 主CLI
用法: voice-cli <command> [options]
"""
import sys
import os
import argparse
import subprocess

# 确保v2/src在路径中
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.contacts_db import (
    contact_add, contact_list, contact_get, contact_delete,
    contact_blacklist, contact_whitelist, contact_find_by_name,
    contact_increment_call, contact_identify, normalize_phone
)
from src.sms_db import sms_save, sms_list


def cmd_contact_add(args):
    contact_add(
        name=args.name or args.phone,
        phone=args.phone,
        relationship=args.relationship or '其他',
        importance=int(args.importance or 0),
        is_blacklist=args.blacklist,
        is_whitelist=args.whitelist,
        notes=args.notes or ''
    )
    print(f"✅ 已添加: {args.name} ({args.phone})")


def cmd_contact_list(args):
    contacts = contact_list()
    if not contacts:
        print("📇 通讯录为空")
        return
    print(f"📇 通讯录 ({len(contacts)}人)")
    print(f"{'姓名':<10} {'号码':<15} {'关系':<8} {'重要':<4} {'黑':<3} {'白':<3} {'通话数':<6} {'最后通话'}")
    print("-" * 80)
    for c in contacts:
        imp_map = {0: '普通', 1: '重要', 2: '紧急'}
        last = c['last_call_at'] or '无'
        if isinstance(last, str):
            last = last[:10]
        print(f"{c['name']:<10} {c['phone']:<15} {c['relationship']:<8} "
              f"{imp_map.get(c['importance'],'?'):<4} "
              f"{'✅' if c['is_blacklist'] else '':<3} "
              f"{'✅' if c['is_whitelist'] else '':<3} "
              f"{c['call_count']:<6} {last}")


def cmd_contact_search(args):
    contacts = contact_find_by_name(args.query)
    if not contacts:
        print(f"未找到: {args.query}")
        return
    for c in contacts:
        print(f"  {c['name']} | {c['phone']} | {c['relationship']} | "
              f"重要={c['importance']} | 黑={'✅' if c['is_blacklist'] else ''} | 白={'✅' if c['is_whitelist'] else ''}")


def cmd_contact_delete(args):
    phone_norm = normalize_phone(args.phone)
    contact = contact_get(args.phone)
    if not contact:
        print(f"未找到联系人: {args.phone}")
        return
    if contact_delete(args.phone):
        print(f"🗑️ 已删除: {contact['name']} ({args.phone})")
    else:
        print(f"删除失败")


def cmd_contact_blacklist(args):
    contact = contact_get(args.phone)
    name = contact['name'] if contact else args.phone
    contact_blacklist(args.phone)
    print(f"🚫 已加入黑名单: {name} ({args.phone})")


def cmd_contact_whitelist(args):
    contact = contact_get(args.phone)
    name = contact['name'] if contact else args.phone
    contact_whitelist(args.phone)
    print(f"✅ 已加入白名单: {name} ({args.phone})")


def cmd_sms_send(args):
    from src.at_commands import sms_send
    phone = args.phone
    if args.name and not args.phone:
        # 通过姓名查号
        results = contact_find_by_name(args.name)
        if not results:
            print(f"未找到联系人: {args.name}")
            return
        phone = results[0]['phone']
    ok = sms_send(phone, args.content)
    if ok:
        print(f"✅ 短信已发送至 {phone}")
    else:
        print(f"❌ 短信发送失败")


def cmd_sms_group(args):
    from src.at_commands import sms_send
    phones = [p.strip() for p in args.phones.split(',')]
    ok_count = 0
    for phone in phones:
        if sms_send(phone, args.content):
            ok_count += 1
    print(f"📨 群发完成: {ok_count}/{len(phones)} 成功")


def cmd_sms_list(args):
    messages = sms_list(limit=args.limit or 20, phone=args.contact)
    if not messages:
        print("无短信记录")
        return
    dir_icon = {'inbound': '📥', 'outbound': '📤'}
    for m in messages:
        icon = dir_icon.get(m['direction'], '?')
        contact = m.get('contact_name', '')
        ts = str(m['created_at'])[:19]
        print(f"{icon} [{ts}] {contact or m['phone']} | {m['content'][:50]}")


def cmd_call_dial(args):
    from src.outbound_handler import outbound_dial
    phone = args.phone
    if args.name and not args.phone:
        results = contact_find_by_name(args.name)
        if not results:
            print(f"未找到联系人: {args.name}")
            return
        phone = results[0]['phone']
        print(f"找到: {results[0]['name']} → 拨号 {phone}")
    print(f"📞 正在呼叫: {phone}")
    result = outbound_dial(phone, tts_message=args.tts)
    if result:
        print(f"✅ 通话完成")
    else:
        print(f"❌ 通话失败")


def cmd_call_play(args):
    from src.outbound_handler import play_audio_to_call
    ok = play_audio_to_call(args.file)
    print(f"{'✅' if ok else '❌'} 播放: {args.file}")


def cmd_call_tts(args):
    from src.outbound_handler import play_tts_to_call
    ok = play_tts_to_call(args.text)
    print(f"{'✅' if ok else '❌'} TTS播放: {args.text[:30]}")


def main():
    parser = argparse.ArgumentParser(description='4G语音通讯系统 v2 CLI')
    sub = parser.add_subparsers(dest='cmd', metavar='<command>')

    # ── contact ──
    p_contact = sub.add_parser('contact', help='通讯录管理')
    sp = p_contact.add_subparsers(dest='sub', metavar='<action>')

    ca = sp.add_parser('add', help='添加联系人')
    ca.add_argument('--name', required=True, help='姓名')
    ca.add_argument('--phone', required=True, help='号码')
    ca.add_argument('--relationship', help='关系(家人/同事/朋友/快递/客服/其他)')
    ca.add_argument('--importance', choices=['0','1','2'], help='重要程度')
    ca.add_argument('--blacklist', action='store_true', help='加入黑名单')
    ca.add_argument('--whitelist', action='store_true', help='加入白名单')
    ca.add_argument('--notes', help='备注')

    sp.add_parser('list', help='列出通讯录')

    cs = sp.add_parser('search', help='搜索联系人')
    cs.add_argument('query', help='搜索关键词')

    cd = sp.add_parser('delete', help='删除联系人')
    cd.add_argument('phone', help='号码')

    cbl = sp.add_parser('blacklist', help='加入黑名单')
    cbl.add_argument('phone', help='号码')

    cwl = sp.add_parser('whitelist', help='加入白名单')
    cwl.add_argument('phone', help='号码')

    # ── sms ──
    p_sms = sub.add_parser('sms', help='短信管理')
    sms_sp = p_sms.add_subparsers(dest='sub', metavar='<action>')

    ss = sms_sp.add_parser('send', help='发送短信')
    ss.add_argument('--phone', help='号码')
    ss.add_argument('--name', help='姓名（自动查号）')
    ss.add_argument('--content', required=True, help='短信内容')

    sg = sms_sp.add_parser('group', help='群发短信')
    sg.add_argument('--phones', required=True, help='逗号分隔号码')
    sg.add_argument('--content', required=True, help='短信内容')

    sl = sms_sp.add_parser('list', help='查看短信历史')
    sl.add_argument('--contact', help='按联系人筛选')
    sl.add_argument('--limit', type=int, help='条数限制')

    # ── call ──
    p_call = sub.add_parser('call', help='通话管理')
    call_sp = p_call.add_subparsers(dest='sub', metavar='<action>')

    cdial = call_sp.add_parser('dial', help='拨打电话')
    cdial.add_argument('--phone', help='号码')
    cdial.add_argument('--name', help='姓名（自动查号）')
    cdial.add_argument('--tts', help='通话前TTS内容（对方可听到）')

    cplay = call_sp.add_parser('play', help='播放录音给通话对方')
    cplay.add_argument('file', help='WAV文件路径')

    ctts = call_sp.add_parser('tts', help='TTS播放给通话对方')
    ctts.add_argument('text', help='要说的文字')

    # ── listener ──
    p_listener = sub.add_parser('listener', help='启动监听进程')
    p_listener.add_argument('--fg', action='store_true', help='前台运行')

    args = parser.parse_args()

    if not args.cmd:
        parser.print_help()
        return

    handlers = {
        ('contact', 'add'): cmd_contact_add,
        ('contact', 'list'): cmd_contact_list,
        ('contact', 'search'): cmd_contact_search,
        ('contact', 'delete'): cmd_contact_delete,
        ('contact', 'blacklist'): cmd_contact_blacklist,
        ('contact', 'whitelist'): cmd_contact_whitelist,
        ('sms', 'send'): cmd_sms_send,
        ('sms', 'group'): cmd_sms_group,
        ('sms', 'list'): cmd_sms_list,
        ('call', 'dial'): cmd_call_dial,
        ('call', 'play'): cmd_call_play,
        ('call', 'tts'): cmd_call_tts,
    }

    key = (args.cmd, args.sub)
    # 默认子命令处理
    if key not in handlers:
        if args.cmd == 'contact' and args.sub is None:
            cmd_contact_list(args)
        elif args.cmd == 'listener':
            _start_listener(args)
        else:
            parser.print_help()
        return
    handlers[key](args)


def _start_listener(args):
    """启动监听进程"""
    script = os.path.join(os.path.dirname(__file__), '../src/voice_listener.py')
    if args.fg:
        os.execv(sys.executable, [sys.executable, script])
    else:
        import subprocess
        subprocess.Popen(
            [sys.executable, script],
            stdout=open('/home/ai/.openclaw/workspace/logs/voice-v2/listener.log', 'a'),
            stderr=subprocess.STDOUT
        )
        print("🚀 监听进程已启动")


if __name__ == '__main__':
    main()
