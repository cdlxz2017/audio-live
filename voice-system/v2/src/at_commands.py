"""
at_commands.py - AT命令封装（拨号/接听/挂断/短信发送）
"""
import serial
import time
import re
import logging
from typing import Optional, Tuple
from src.config import config

log = logging.getLogger('voice.at')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    filename=config['serial'].get('log_file', '/home/ai/.openclaw/workspace/logs/voice-v2/at.log')
)

AT_PORT = config['serial']['at_port']
SMS_PORT = config['serial']['sms_port']
BAUD = config['serial']['baud']


def _open_serial(port: str, timeout: float = 1.0) -> serial.Serial:
    s = serial.Serial(port, BAUD, timeout=timeout)
    s.flushInput()
    time.sleep(0.3)
    return s


def _at_cmd(s: serial.Serial, cmd: str, delay: float = 0.5,
            timeout: float = 2.0) -> str:
    """发送AT命令并读取响应"""
    s.write((cmd + '\r\n').encode())
    time.sleep(delay)
    resp = ''
    deadline = time.time() + timeout
    while time.time() < deadline:
        if s.in_waiting > 0:
            resp += s.read(s.in_waiting).decode(errors='replace')
        time.sleep(0.05)
    return resp


def _at_cmd_raw(port: str, cmd: str, delay: float = 0.5) -> str:
    """单次AT命令（自动开闭串口）"""
    try:
        with _open_serial(port) as s:
            return _at_cmd(s, cmd, delay)
    except Exception as e:
        log.error(f"AT命令失败 {cmd}: {e}")
        return ''


def init_module(port: str = AT_PORT) -> bool:
    """初始化4G模块"""
    try:
        with _open_serial(port) as s:
            _at_cmd(s, 'AT', delay=0.3)
            _at_cmd(s, 'AT+CREG=0')
            _at_cmd(s, 'AT+CEREG=0')
            _at_cmd(s, 'AT+CLIP=1')
            _at_cmd(s, 'AT+CNMI=2,1,0,1,0')
            _at_cmd(s, 'AT+CLCC=1')
            log.info(f"模块初始化完成 ({port})")
            return True
    except Exception as e:
        log.error(f"模块初始化失败: {e}")
        return False


def query_clcc(port: str = AT_PORT) -> Tuple[Optional[int], str]:
    """查询当前通话状态 CLCC"""
    try:
        with _open_serial(port) as s:
            resp = _at_cmd(s, 'AT+CLCC', delay=0.5)
            m = re.search(r'\+CLCC:\s*(\d+),(\d+),(\d+),(\d+),(\d+),"([^"]*)"', resp)
            if m:
                state = int(m.group(3))  # 0=active, 1=held, 2=dialing, 3=ringing, 4=waiting
                number = m.group(6)
                return state, number
        return None, ''
    except Exception as e:
        log.error(f"CLCC查询失败: {e}")
        return None, ''


def hangup(port: str = AT_PORT) -> bool:
    """挂断电话"""
    try:
        with _open_serial(port) as s:
            resp = _at_cmd(s, 'ATH', delay=1.0)
            log.info(f"HANGUP 响应: {resp[:50]}")
            return 'OK' in resp
    except Exception as e:
        log.error(f"挂断失败: {e}")
        return False


def answer(port: str = AT_PORT, max_attempts: int = 5) -> bool:
    """接听电话"""
    try:
        with _open_serial(port) as s:
            for attempt in range(max_attempts):
                s.write(b'ATA\r\n')
                time.sleep(2)
                state, _ = query_clcc(port)
                log.info(f"[ATA] 尝试{attempt+1}: CLCC={state}")
                if state == 0:
                    log.info("✅ 通话已激活")
                    return True
                elif state is None:
                    time.sleep(1)
                else:
                    time.sleep(1)
            return False
    except Exception as e:
        log.error(f"接听失败: {e}")
        return False


def dial(phone: str, port: str = AT_PORT) -> bool:
    """拨打电话"""
    normalized = re.sub(r'[^\d+]', '', phone)
    log.info(f"拨号: {normalized}")
    try:
        with _open_serial(port) as s:
            resp = _at_cmd(s, f'ATD{normalized};', delay=2.0)
            log.info(f"DIAL 响应: {resp[:80]}")
            return True
    except Exception as e:
        log.error(f"拨号失败: {e}")
        return False


def sms_send(phone: str, content: str, port: str = SMS_PORT) -> bool:
    """
    发送短信（Text模式，UCS2编码支持中文）
    """
    try:
        with _open_serial(port) as s:
            # 切换到Text模式
            _at_cmd(s, 'AT+CMGF=1', delay=0.5)
            # 设置UCS2编码
            _at_cmd(s, 'AT+CSCS="UCS2"', delay=0.5)

            # 转换内容为UCS2 hex
            content_ucs2 = content.encode('utf-16-be').hex().upper()

            # 发送目标号码(UCS2)
            phone_ucs2 = ''
            for c in f'+{re.sub(r"[^\d]", "", phone)}':
                phone_ucs2 += format(ord(c), '04X')

            cmd = f'AT+CMGS="{phone_ucs2}"'
            s.write((cmd + '\r\n').encode())
            time.sleep(1)

            # 发送内容（Ctrl+Z结束）
            s.write(content_ucs2.encode())
            s.write(bytes([26]))  # Ctrl+Z
            time.sleep(3)

            resp = ''
            deadline = time.time() + 10
            while time.time() < deadline:
                if s.in_waiting > 0:
                    resp += s.read(s.in_waiting).decode(errors='replace')
                time.sleep(0.1)

            log.info(f"SMS发送响应: {resp[:80]}")
            return '+CMGS:' in resp or 'OK' in resp
    except Exception as e:
        log.error(f"短信发送失败: {e}")
        return False


def get_signal_quality(port: str = AT_PORT) -> int:
    """获取信号强度 (0-31, 99=未知)"""
    try:
        with _open_serial(port) as s:
            resp = _at_cmd(s, 'AT+CSQ', delay=0.5)
            m = re.search(r'\+CSQ:\s*(\d+),', resp)
            if m:
                return int(m.group(1))
    except:
        pass
    return 99
