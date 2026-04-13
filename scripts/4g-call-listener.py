#!/usr/bin/env python3
"""
A7670G 4G模块 - 来电监听服务（增强版 v2）
- 来电自动接通
- 通话期间自动录音
- 通话结束触发: 转写 → 摘要 → 推送微信
"""

import serial, time, re, os, sys, signal, subprocess
from datetime import datetime

PORT = '/dev/ttyUSB2'
BAUD = 115200
LOG_FILE = '/home/ai/.openclaw/workspace/logs/4g-calls.log'
RECORDINGS_IN = '/home/ai/.openclaw/workspace/voice-system/recordings/inbound'
HANDLER = '/home/ai/.openclaw/workspace/voice-system/src/voice_call_handler.py'
AREPLAY_DEV = 'plughw:1,0'

os.makedirs(RECORDINGS_IN, exist_ok=True)

# ── 录音进程 ─────────────────────────────────────────
rec_proc = None

def start_recording(out_path: str):
    global rec_proc
    stop_recording()
    cmd = ['arecord', '-D', AREPLAY_DEV, '-f', 'S16_LE', '-r', '8000', '-c', '1', out_path]
    rec_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    log(f"[录音] 已启动 PID={rec_proc.pid}")

def stop_recording():
    global rec_proc
    if rec_proc:
        rec_proc.terminate()
        try:
            rec_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            rec_proc.kill()
        log(f"[录音] 已停止")
        rec_proc = None

def cleanup():
    stop_recording()

signal.signal(signal.SIGTERM, lambda *a: cleanup())

# ── 串口读 ─────────────────────────────────────────
def ser_write(s, cmd: bytes, delay=0.3):
    s.write(cmd)
    time.sleep(delay)

def ser_read(s, timeout=2) -> str:
    """读取串口所有可用数据"""
    time.sleep(timeout)
    if s.in_waiting <= 0:
        return ''
    data = s.read(s.in_waiting)
    return data.decode(errors='replace')

# ── 日志 ─────────────────────────────────────────────
def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

# ── 等待指定字符串 ───────────────────────────────────
def wait_for(s, Serial, pattern: str, timeout=10) -> bool:
    """持续读取直到匹配到 pattern 或超时"""
    deadline = time.time() + timeout
    buf = ''
    while time.time() < deadline:
        if s.in_waiting > 0:
            buf += s.read(s.in_waiting).decode(errors='replace')
            if pattern in buf:
                return True
        time.sleep(0.1)
    log(f"[串口] 等待'{pattern}'超时，最后缓冲区: {buf[-200:]}")
    return False

# ── 主循环 ─────────────────────────────────────────
def main():
    log("来电监听服务启动（录音增强版 v2）")
    while True:
        try:
            s = serial.Serial(PORT, BAUD, timeout=0)
            s.flushInput()
            time.sleep(0.5)

            # 关闭 URC 减少干扰
            ser_write(s, b'AT+CREG=0\r\n', 0.3)
            s.read(s.in_waiting)
            ser_write(s, b'AT+CEREG=0\r\n', 0.3)
            s.read(s.in_waiting)
            ser_write(s, b'AT+CLIP=1\r\n', 0.3)
            s.read(s.in_waiting)

            log("模块配置完成，等待来电...")
            buffer = ''
            in_call = False
            call_start = None
            caller = None
            rec_path = None

            while True:
                if s.in_waiting > 0:
                    data = s.read(s.in_waiting).decode(errors='replace')
                    buffer += data

                    # 检测来电号码
                    if not in_call:
                        m = re.search(r'\+CLIP:\s*"([^"]+)"', buffer)
                        if m:
                            caller = m.group(1)
                            log(f"📞 来电: {caller}，自动接听...")
                            ser_write(s, b'ATA\r\n', 0.5)

                            # 等待 OK 或 VOICE CALL: BEGIN
                            ok_buf = s.read(s.in_waiting).decode(errors='replace')
                            time.sleep(2)
                            if s.in_waiting > 0:
                                ok_buf += s.read(s.in_waiting).decode(errors='replace')

                            log(f"[串口] ATA响应: {ok_buf[:100]}")

                            if 'OK' in ok_buf or 'VOICE CALL' in ok_buf:
                                # 开始录音
                                ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                                safe_num = re.sub(r'\D', '', caller)[-11:] if caller else 'unknown'
                                rec_path = os.path.join(RECORDINGS_IN, f'{ts}_{safe_num}.wav')
                                start_recording(rec_path)

                                in_call = True
                                call_start = datetime.now()
                                log(f"通话已开始 ({caller})")
                            else:
                                log(f"[错误] ATA未确认，继续监听")
                            buffer = ''

                    # 检测通话结束
                    if in_call:
                        if 'NO CARRIER' in buffer or 'VOICE CALL: END' in buffer or '+CLCC:' in buffer:
                            duration = (datetime.now() - call_start).seconds
                            log(f"📞 通话结束: {caller}，时长 {duration} 秒")
                            stop_recording()

                            # 触发后处理
                            if rec_path and os.path.exists(rec_path):
                                handler_cmd = [sys.executable, HANDLER, rec_path, caller or '', str(duration)]
                                log(f"启动处理器...")
                                subprocess.Popen(
                                    handler_cmd,
                                    stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL
                                )
                            else:
                                log(f"[警告] 录音文件不存在: {rec_path}")

                            in_call = False
                            caller = None
                            rec_path = None
                            buffer = ''

                    # 清理缓冲区
                    if len(buffer) > 500:
                        buffer = ''

                time.sleep(0.05)

        except serial.SerialException as e:
            log(f"串口错误: {e}，3秒后重连...")
            cleanup()
            time.sleep(3)
        except Exception as e:
            log(f"异常: {e}，5秒后重连...")
            cleanup()
            time.sleep(5)

if __name__ == '__main__':
    main()
