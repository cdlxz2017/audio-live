#!/usr/bin/env python3
"""
A7670G 接收短信 PDU 解码脚本
用法:
  python3 4g-sms-decode.py <PDU_hex>           # 解码指定 PDU
  python3 4g-sms-decode.py --listen            # 监听并自动解码新短信
"""

import serial, time, sys, re

PORT = '/dev/ttyUSB2'
BAUD = 115200


def decode_7bit(hex_str: str) -> str:
    """将 7-bit GSM 编码的 hex 解码为字符串"""
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


def decode_pdu(pdu_hex: str) -> dict:
    """解码 PDU 短信，返回解析结果字典"""
    pdu = pdu_hex.strip().replace(' ', '').replace('-', '')
    result = {}

    # ========== SMSC ==========
    smsc_len = int(pdu[0:2], 16)
    if smsc_len > 0:
        smsc_hex = pdu[2:2 + smsc_len * 2]
        addr_hex = smsc_hex[4:]
        digits = ''
        for i in range(0, len(addr_hex) - 2, 2):
            digits += addr_hex[i + 1] + addr_hex[i]
        digits = digits.rstrip('Ff').rstrip('F')
        result['smsc'] = f"+{digits}"
    else:
        result['smsc'] = None

    # ========== TPDU ==========
    tpdu = pdu[2 + smsc_len * 2:]

    # First octet (SMS-DELIVER = 24)
    first = int(tpdu[0:2], 16)
    result['mti'] = 'SMS-DELIVER'

    # Sender address
    oa_len = int(tpdu[2:4], 16)
    oa_hex = tpdu[6:6 + (oa_len // 2 + 2) * 2]
    sender = ''
    for i in range(0, len(oa_hex) - 2, 2):
        sender += oa_hex[i + 1] + oa_hex[i]
    sender = sender[:oa_len].rstrip('Ff')
    result['sender'] = sender

    # After sender: PID + DCS + SCTS + UDL + UD
    after = 6 + (oa_len // 2 + 2) * 2
    remaining = tpdu[after:]

    pid = remaining[0:2]
    dcs_hex = remaining[2:4]
    scts = remaining[4:20]
    udl = int(remaining[20:22], 16)
    ud_hex = remaining[22:22 + udl * 2] if len(remaining) >= 22 + udl * 2 else remaining[22:]

    result['dcs'] = dcs_hex
    result['udl'] = udl
    result['raw_ud'] = ud_hex

    # Parse timestamp (BCD semi-octet)
    def parse_scts(h):
        if len(h) < 14:
            return h
        yr = h[1] + h[0]
        mo = h[3] + h[2]
        dy = h[5] + h[4]
        hr = h[7] + h[6]
        mn = h[9] + h[8]
        sc = h[11] + h[10]
        tz = h[13:16]
        tz_val = int(tz, 16)
        tz_sign = '+' if tz_val < 128 else '-'
        tz_num = (tz_val - 128) if tz_val >= 128 else tz_val
        return f"20{yr}-{mo}-{dy} {hr}:{mn}:{sc} (GMT{'+' if tz_val < 128 else ''}{tz_num})"

    result['timestamp'] = parse_scts(scts)

    # ========== 解码用户数据 ==========
    encoding = 'unknown'
    text = ''

    # 策略：尝试多种解码，取第一个得到有效结果（优先中文）
    candidates = []

    # 1. 纯 UTF-16-BE
    try:
        t = bytes.fromhex(ud_hex).decode('utf-16-be')
        if t:
            candidates.append(('UCS-2', t))
    except Exception:
        pass

    # 2. 跳过 N 个 nibble 后的 UTF-16-BE（部分模块格式）
    for skip in [2, 4]:
        if len(ud_hex) > skip:
            sub = ud_hex[skip:]
            if len(sub) % 2 == 0 and len(sub) >= 4:
                try:
                    t = bytes.fromhex(sub).decode('utf-16-be')
                    if t:
                        candidates.append((f'UCS-2 (skip{skip}nib)', t))
                except Exception:
                    pass

    # 3. 7-bit GSM
    try:
        t = decode_7bit(ud_hex)
        if t and len(t) >= 1:
            candidates.append(('7-bit GSM', t))
    except Exception:
        pass

    # 4. UTF-16-LE
    try:
        t = bytes.fromhex(ud_hex).decode('utf-16-le')
        if t:
            candidates.append(('UCS-2-LE', t))
    except Exception:
        pass

    # 优先选有中文的
    for enc_name, enc_text in candidates:
        has_cjk = any('\u4e00' <= c <= '\u9fff' for c in enc_text)
        if has_cjk:
            text = enc_text
            encoding = enc_name
            break

    if not text and candidates:
        encoding, text = candidates[0]

    if not text:
        encoding = f'raw (DCS={dcs_hex})'
        text = ud_hex

    result['encoding'] = encoding
    result['text'] = text.strip()

    return result


def format_result(r: dict) -> str:
    lines = [
        f"📩 短信解码结果",
        f"{'=' * 32}",
        f"发送方: {r['sender']}",
        f"SMSC:   {r['smsc'] or '(无)'}",
        f"编码:   {r['encoding']}",
        f"时间:   {r['timestamp']}",
        f"{'=' * 32}",
        f"内容: {r['text']}",
    ]
    return '\n'.join(lines)


def listen_and_decode():
    """监听串口，自动解码收到的短信"""
    print(f"📡 开始监听 {PORT}，等待收到短信... (Ctrl+C 退出)")
    s = serial.Serial(PORT, BAUD, timeout=0)
    s.flushInput()

    # 开启主动上报
    s.write(b'AT+CREG=2\r\n')
    time.sleep(0.5)
    s.read(s.in_waiting)
    s.write(b'AT+CNMI=2,2,0,0,0\r\n')
    time.sleep(0.5)
    s.read(s.in_waiting)
    s.write(b'AT+CMGF=0\r\n')
    time.sleep(0.5)
    s.read(s.in_waiting)

    buffer = ''
    try:
        while True:
            if s.in_waiting > 0:
                data = s.read(s.in_waiting).decode(errors='replace')
                buffer += data
                # 匹配 +CMT: "<oda>",<length>\n<pdu>\n
                match = re.search(r'\+CMT:\s*"[^"]*",(\d+)\s*\n([0-9A-Fa-f]+)', buffer)
                if match:
                    pdu_len = int(match.group(1))
                    pdu = match.group(2).strip()
                    print(f"\n捕获 PDU (length={pdu_len}): {pdu[:60]}...")
                    try:
                        r = decode_pdu(pdu)
                        print(format_result(r))
                    except Exception as e:
                        print(f"解码失败: {e}")
                    buffer = ''
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\n监听结束")
    finally:
        s.close()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        print("\n示例:")
        print("  python3 4g-sms-decode.py 0891683109520000F0240BA18181805096F6000862403130753423046D4B8BD5")
        print("  python3 4g-sms-decode.py --listen")
        sys.exit(1)

    if sys.argv[1] == '--listen':
        listen_and_decode()
    else:
        pdu = sys.argv[1]
        r = decode_pdu(pdu)
        print(format_result(r))
