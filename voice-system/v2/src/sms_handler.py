"""
sms_handler.py - 短信接收处理（监听 + PDU解码）
"""
import serial
import time
import re
import logging
import sys
import os
import signal
import threading
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from src.config import config
from src.at_commands import SMS_PORT, BAUD, init_module
from src.sms_db import sms_save
from src.contacts_db import contact_identify
from src.notifier import notify_sms

# 复用4g-sms-decode.py的decode逻辑
SMS_DECODE_PATH = '/home/ai/.openclaw/workspace/scripts/4g-sms-decode.py'

log = logging.getLogger('voice.sms')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    filename='/home/ai/.openclaw/workspace/logs/voice-v2/sms_handler.log'
)


def decode_pdu(pdu_hex: str) -> dict:
    """解码PDU短信，复用现有逻辑"""
    try:
        # 动态导入decode函数
        import importlib.util
        spec = importlib.util.spec_from_file_location("sms_decode", SMS_DECODE_PATH)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.decode_pdu(pdu_hex)
    except Exception as e:
        log.error(f"PDU解码失败: {e}")
        return {}


def handle_sms_async(sender: str, content: str, timestamp: str):
    """异步处理：存DB + 推送微信"""
    def _run():
        try:
            # 保存到DB
            sms_id = sms_save(sender, content, 'inbound', sms_at=None)
            # 识别联系人
            contact = contact_identify(sender)
            sender_name = contact['name'] if contact else sender
            # 推送微信
            notify_sms(sender_name, sender, content)
            log.info(f"短信处理完成: {sender} → {content[:30]}")
        except Exception as e:
            log.error(f"短信后处理异常: {e}")

    threading.Thread(target=_run, daemon=True).start()


def sms_listener():
    """监听短信串口，自动接收并处理"""
    log.info(f"短信监听启动: {SMS_PORT}")
    s = None
    buffer = ''
    shutdown = False

    def _cleanup(*args):
        nonlocal shutdown
        shutdown = True
        if s:
            s.close()

    signal.signal(signal.SIGTERM, _cleanup)
    signal.signal(signal.SIGINT, _cleanup)

    try:
        s = serial.Serial(SMS_PORT, BAUD, timeout=0)
        s.flushInput()

        # 初始化模块（短信口）
        init_module(SMS_PORT)

        while not shutdown:
            if s.in_waiting > 0:
                data = s.read(s.in_waiting).decode(errors='replace')
                buffer += data

                # 匹配: +CMT: "<oda>",<length>\n<pdu>\n
                match = re.search(
                    r'\+CMT:\s*"[^"]*",(\d+)\s*\n([0-9A-Fa-f]+)',
                    buffer
                )
                if match:
                    pdu_len = int(match.group(1))
                    pdu = match.group(2).strip()
                    log.info(f"捕获短信 PDU (len={pdu_len}): {pdu[:60]}...")

                    try:
                        result = decode_pdu(pdu)
                        sender = result.get('sender', 'unknown')
                        content = result.get('text', '')
                        timestamp = result.get('timestamp', '')
                        log.info(f"📩 短信: {sender} | {content[:50]}")
                        # 异步处理
                        handle_sms_async(sender, content, timestamp)
                    except Exception as e:
                        log.error(f"短信处理失败: {e}")

                    buffer = ''

            time.sleep(0.05)

    except Exception as e:
        log.error(f"短信监听异常: {e}")
    finally:
        if s:
            s.close()


if __name__ == '__main__':
    sms_listener()
