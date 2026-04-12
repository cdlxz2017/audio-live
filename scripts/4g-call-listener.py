#!/usr/bin/env python3
"""
A7670G 4G模块 - 来电监听服务（PM2 守护）
- 监听来电，自动接通
- 通话结束后记录日志
- 注意：自动接通后通话会保持直到对方挂断或超时
"""

import serial, time, re, os
from datetime import datetime

PORT = '/dev/ttyUSB2'
BAUD = 115200
LOG_FILE = '/home/ai/.openclaw/workspace/logs/4g-calls.log'

def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

def main():
    log("来电监听服务启动（自动接听模式）")
    while True:
        try:
            s = serial.Serial(PORT, BAUD, timeout=0)
            s.flushInput()
            time.sleep(1)
            # 关闭 URC
            s.write(b'AT+CREG=0\r\n')
            time.sleep(0.5)
            s.read(s.in_waiting)
            s.write(b'AT+CEREG=0\r\n')
            time.sleep(0.5)
            s.read(s.in_waiting)
            # 开启来电显示
            s.write(b'AT+CLIP=1\r\n')
            time.sleep(0.5)
            s.read(s.in_waiting)
            log("模块配置完成，等待来电...")
            buffer = ''
            in_call = False
            call_start = None
            caller = None
            while True:
                if s.in_waiting > 0:
                    data = s.read(s.in_waiting).decode(errors='replace')
                    buffer += data
                    # 提取来电号码
                    m = re.search(r'\+CLIP:\s*"([^"]+)"', buffer)
                    if m and not in_call:
                        caller = m.group(1)
                        log(f"📞 来电: {caller}，自动接听...")
                        s.write(b'ATA\r\n')
                        time.sleep(2)
                        resp = s.read(s.in_waiting).decode(errors='ignore')
                        if 'VOICE CALL: BEGIN' in resp or 'OK' in resp:
                            in_call = True
                            call_start = datetime.now()
                            log(f"通话已开始 ({caller})")
                        buffer = ''
                    # 通话结束
                    if 'NO CARRIER' in buffer or 'VOICE CALL: END' in buffer:
                        if in_call:
                            duration = (datetime.now() - call_start).seconds
                            log(f"📞 通话结束: {caller}，时长 {duration} 秒")
                            in_call = False
                            caller = None
                        buffer = ''
                    # 检测挂断
                    if '+CLCC:' in buffer and '6,0,0' in buffer:
                        if in_call:
                            duration = (datetime.now() - call_start).seconds
                            log(f"📞 被叫挂断: {caller}，时长 {duration} 秒")
                            in_call = False
                            caller = None
                        buffer = ''
                    # 清理
                    if len(buffer) > 500:
                        buffer = ''
                time.sleep(0.05)
        except serial.SerialException as e:
            log(f"串口错误: {e}，3秒后重连...")
            time.sleep(3)
        except Exception as e:
            log(f"异常: {e}，5秒后重连...")
            time.sleep(5)

if __name__ == '__main__':
    main()
