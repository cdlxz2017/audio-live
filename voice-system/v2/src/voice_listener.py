#!/usr/bin/env python3
"""
voice_listener.py - 4G来电监听主进程
事件驱动：来电 → 识别 → 录音 → 触发后处理
"""
import sys
import os
import serial
import time
import re
import signal
import logging
import json
import threading
from datetime import datetime
from pathlib import Path

# ── 路径 ───────────────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from src.config import config
from src.at_commands import AT_PORT, BAUD, answer, hangup, query_clcc, init_module
from src.audio_recorder import AudioRecorder, detect_quality, normalize_audio
from src.contacts_db import contact_identify, contact_blacklist_check, contact_increment_call
from src.transcriber import transcribe as whisper_transcribe
from src.summarizer import summarize
from src.notifier import notify_call
from src.calls_db import call_save

LOG_FILE = '/home/ai/.openclaw/workspace/logs/voice-v2/listener.log'
RECORDINGS_IN = Path('/home/ai/.openclaw/workspace/voice-system/recordings/inbound')
EVENTS_DIR = Path('/tmp/voice-events')
EVENTS_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
log = logging.getLogger('voice.listener')


# ── 全局状态 ───────────────────────────────────────
recorder = None
in_call = False
call_start = None
caller = None
ring_count = 0
ringing = False
shutdown = False


def cleanup(*args):
    global shutdown
    log.info("收到退出信号，停止监听...")
    shutdown = True
    if recorder:
        recorder.stop()

signal.signal(signal.SIGTERM, cleanup)
signal.signal(signal.SIGINT, cleanup)


def write_event(event_type: str, data: dict):
    """写事件文件供后处理进程消费"""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    event_file = EVENTS_DIR / f"{ts}_{event_type}.json"
    with open(event_file, 'w') as f:
        json.dump({'type': event_type, 'ts': ts, **data}, f, ensure_ascii=False, default=str)
    log.info(f"事件已写入: {event_file}")


def process_call_async(wav_path: str, caller: str, duration: int):
    """异步后处理：转写 → 摘要 → 推送"""
    def _run():
        try:
            # 音频质量检测
            quality = detect_quality(wav_path)
            # 标准化音频
            normalize_audio(wav_path)
            # 转写
            transcript = whisper_transcribe(wav_path)
            # 识别联系人
            contact = contact_identify(caller)
            caller_name = contact['name'] if contact else caller
            # 摘要
            summary = summarize(transcript, caller, duration)
            # 推送微信
            notify_call(caller_name, caller, duration, summary, transcript)
            # 更新通话计数
            contact_increment_call(caller)
            # 保存通话记录
            call_save(caller, 'inbound', duration, transcript=transcript,
                      summary=summary, recording_path=wav_path, quality_ok=quality['quality_ok'])
            # 写事件
            write_event('call_processed', {
                'wav': wav_path, 'caller': caller,
                'caller_name': caller_name, 'duration': duration,
                'transcript': transcript, 'summary': summary,
                'quality_ok': quality['quality_ok'],
                'max_volume': quality['max_volume']
            })
        except Exception as e:
            log.error(f"后处理异常: {e}")

    threading.Thread(target=_run, daemon=True).start()


def handle_incoming_call(port: str):
    """主循环：监听来电"""
    global recorder, in_call, call_start, caller, ring_count, ringing

    buffer = ''
    s = None
    try:
        s = serial.Serial(port, BAUD, timeout=0)
        s.flushInput()
        log.info(f"串口已连接: {port}")

        # 初始化模块
        init_module(port)

        while not shutdown:
            if s.in_waiting > 0:
                data = s.read(s.in_waiting).decode(errors='replace')
                buffer += data

                # ── 来电号码检测 ─────────────────────
                if not in_call:
                    clip_m = re.search(r'\+CLIP:\s*"([^"]+)"', buffer)
                    if clip_m and not caller:
                        caller = clip_m.group(1)
                        log.info(f"📞 来电号码: {caller}")

                        # 黑名单检查
                        if contact_blacklist_check(caller):
                            log.warning(f"🚫 黑名单来电，自动挂断: {caller}")
                            hangup(port)
                            buffer = ''
                            caller = None
                            continue

                    # RING检测
                    ring_matches = re.findall(r'\bRING\b', buffer)
                    if ring_matches:
                        ring_count += len(ring_matches)
                        if not ringing:
                            ringing = True
                            log.info(f"📞 振铃 (RING x{ring_count})")

                    # 2次振铃后自动接听
                    if ringing and ring_count >= 2 and caller:
                        log.info(f"📞 接听来电: {caller}")
                        buffer = ''
                        answered = answer(port)

                        if answered:
                            in_call = True
                            call_start = datetime.now()

                            # 开始录音
                            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                            safe = re.sub(r'\D', '', caller)[-11:] if caller else 'unknown'
                            rec_path = str(RECORDINGS_IN / f'{ts}_{safe}.wav')
                            recorder = AudioRecorder(rec_path)
                            recorder.start()
                            log.info(f"🎙️ 录音开始: {rec_path}")

            # ── 通话状态监控 ─────────────────────────
            if in_call:
                state, _ = query_clcc(port)
                if state is None:
                    # 通话结束
                    log.info("📴 通话已结束")
                    if recorder:
                        duration = 0
                        if call_start:
                            duration = int((datetime.now() - call_start).total_seconds())
                        recorder.stop()
                        # 触发后处理
                        process_call_async(rec_path, caller, duration)

                    # 重置状态
                    in_call = False
                    call_start = None
                    caller = None
                    ring_count = 0
                    ringing = False
                    recorder = None
                    buffer = ''

            time.sleep(0.05)

    except Exception as e:
        log.error(f"监听异常: {e}")
    finally:
        if s:
            s.close()
        if recorder:
            recorder.stop()


def main():
    log.info("=" * 50)
    log.info("4G语音监听进程 v2 启动")
    log.info("=" * 50)
    handle_incoming_call(AT_PORT)


if __name__ == '__main__':
    main()
