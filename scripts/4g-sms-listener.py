#!/usr/bin/env python3
"""
A7670G 4G模块 - 短信监听服务（PM2 守护）
- 监听接收短信并解码
- 日志记录到文件
- 来短信时通知主会话
"""

import serial, time, re, sys, os
from datetime import datetime

PORT = '/dev/ttyUSB2'
BAUD = 115200
LOG_FILE = '/home/ai/.openclaw/workspace/logs/4g-sms.log'

def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

def decode_7bit(hex_str):
    GSM_7BITS = (
        '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ '
        '!"#¤%&\'()*+,-./0123456789:;<=>?'
        '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§'
        '¿abcdefghijklmnopqrstuvwxyzäöñüà'
    )
    bits = bin(int(hex_str, 16))[2:].zfill(len(hex_str) * 4)
    chars = []
    for i in range(0, len(bits) - 6, 7):
        char_bits = bits[i:i + 7]
        char_val = int(char_bits, 2)
        if char_val < len(GSM_7BITS):
            chars.append(GSM_7BITS[char_val])
        else:
            chars.append(f'[{char_val}]')
    return ''.join(chars)

def decode_pdu(pdu_hex):
    pdu = pdu_hex.strip().replace(' ', '').replace('-', '')
    result = {'sender': '', 'text': '', 'smsc': '', 'encoding': '', 'timestamp': ''}
    try:
        smsc_len = int(pdu[0:2], 16)
        if smsc_len > 0:
            smsc_hex = pdu[2:2 + smsc_len * 2]
            addr_hex = smsc_hex[4:]
            digits = ''
            for i in range(0, len(addr_hex) - 2, 2):
                digits += addr_hex[i + 1] + addr_hex[i]
            digits = digits.rstrip('Ff').rstrip('F')
            result['smsc'] = f"+{digits}"
        tpdu = pdu[2 + smsc_len * 2:]
        oa_len = int(tpdu[2:4], 16)
        oa_hex = tpdu[6:6 + (oa_len // 2 + 2) * 2]
        sender = ''
        for i in range(0, len(oa_hex) - 2, 2):
            sender += oa_hex[i + 1] + oa_hex[i]
        sender = sender[:oa_len].rstrip('Ff')
        result['sender'] = sender
        after = 6 + (oa_len // 2 + 2) * 2
        remaining = tpdu[after:]
        dcs_hex = remaining[2:4]
        scts = remaining[4:20]
        udl = int(remaining[20:22], 16)
        ud_hex = remaining[22:22 + udl * 2] if len(remaining) >= 22 + udl * 2 else remaining[22:]
        # Parse timestamp
        yr = '20' + scts[1] + scts[0]
        mo = scts[3] + scts[2]
        dy = scts[5] + scts[4]
        hr = scts[7] + scts[6]
        mn = scts[9] + scts[8]
        sc = scts[11] + scts[10]
        result['timestamp'] = f"{yr}-{mo}-{dy} {hr}:{mn}:{sc}"
        # Decode
        text = ''
        encoding = 'unknown'
        candidates = []
        for skip in [0, 2, 4]:
            if len(ud_hex) > skip:
                sub = ud_hex[skip:]
                if len(sub) % 2 == 0 and len(sub) >= 4:
                    try:
                        t = bytes.fromhex(sub).decode('utf-16-be')
                        if t:
                            candidates.append((f'UCS-2(skip{skip})', t))
                    except:
                        pass
        try:
            t = decode_7bit(ud_hex)
            if t:
                candidates.append(('7-bit GSM', t))
        except:
            pass
        for enc_name, enc_text in candidates:
            has_cjk = any('\u4e00' <= c <= '\u9fff' for c in enc_text)
            if has_cjk:
                text = enc_text
                encoding = enc_name
                break
        if not text and candidates:
            encoding, text = candidates[0]
        if not text:
            text = ud_hex
            encoding = f'raw(DCS={dcs_hex})'
        result['text'] = text.strip()
        result['encoding'] = encoding
    except Exception as e:
        result['text'] = f"[解码失败: {e}]"
    return result

def main():
    log("短信监听服务启动")
    while True:
        try:
            s = serial.Serial(PORT, BAUD, timeout=0)
            s.flushInput()
            time.sleep(1)
            # 配置模块
            s.write(b'AT+CREG=2\r\n')
            time.sleep(0.5)
            s.read(s.in_waiting)
            s.write(b'AT+CEREG=0\r\n')
            time.sleep(0.5)
            s.read(s.in_waiting)
            s.write(b'AT+CNMI=2,2,0,0,0\r\n')
            time.sleep(0.5)
            s.read(s.in_waiting)
            s.write(b'AT+CMGF=0\r\n')
            time.sleep(0.5)
            s.read(s.in_waiting)
            log("模块配置完成，等待短信...")
            buffer = ''
            while True:
                if s.in_waiting > 0:
                    data = s.read(s.in_waiting).decode(errors='replace')
                    buffer += data
                    match = re.search(r'\+CMT:\s*"[^"]*",(\d+)\s*\n([0-9A-Fa-f]+)', buffer)
                    if match:
                        pdu = match.group(2).strip()
                        log(f"收到 PDU: {pdu[:40]}...")
                        r = decode_pdu(pdu)
                        log(f"📩 短信 | 发件人: {r['sender']} | 编码: {r['encoding']} | 时间: {r['timestamp']} | 内容: {r['text']}")
                        buffer = ''
                time.sleep(0.1)
        except serial.SerialException as e:
            log(f"串口错误: {e}，3秒后重连...")
            time.sleep(3)
        except Exception as e:
            log(f"异常: {e}，5秒后重连...")
            time.sleep(5)

if __name__ == '__main__':
    main()
