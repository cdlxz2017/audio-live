"""
outbound_handler.py - 外呼处理（拨号 + TTS播放 + 录音）
"""
import subprocess
import time
import logging
import os
from datetime import datetime
from pathlib import Path

from src.config import config
from src.at_commands import AT_PORT, dial, hangup, query_clcc, answer
from src.audio_recorder import AudioRecorder
from src.tts_client import generate_tts, tts_and_play
from src.contacts_db import contact_identify, contact_increment_call
from src.calls_db import call_save

log = logging.getLogger('voice.outbound')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    filename='/home/ai/.openclaw/workspace/logs/voice-v2/outbound.log'
)

RECORDINGS_OUT = Path('/home/ai/.openclaw/workspace/voice-system/recordings/outbound')
RECORDINGS_OUT.mkdir(parents=True, exist_ok=True)


def outbound_dial(phone: str, tts_message: str = None) -> bool:
    """
    外呼流程：
    1. 拨号
    2. 等待接通
    3. 播放TTS（如果提供了的话）
    4. 等待通话结束
    5. 挂断
    """
    log.info(f"外呼开始: {phone}")
    ts_str = datetime.now().strftime('%Y%m%d_%H%M%S')
    safe = phone[-11:]
    rec_path = str(RECORDINGS_OUT / f'{ts_str}_{safe}.wav')

    # 拨号
    dial(phone)
    log.info(f"等待接通: {phone}")

    # 等待接通（CLCC state=0表示active）
    connected = False
    for i in range(30):  # 最多等30秒
        state, _ = query_clcc(AT_PORT)
        if state == 0:
            connected = True
            log.info(f"✅ 已接通")
            break
        time.sleep(1)

    if not connected:
        log.warning(f"未接通，超时")
        return False

    # 接通后开始录音
    recorder = AudioRecorder(rec_path)
    recorder.start()

    # 播放TTS（如果提供了）
    if tts_message:
        log.info(f"播放TTS: {tts_message[:30]}")
        # 生成TTS并播放（通过HDMI → 3.5mm环回 → 模块MIC）
        tts_and_play(tts_message, device=config['audio']['output_device'])

    # 等待通话结束
    log.info("等待通话结束...")
    while True:
        state, _ = query_clcc(AT_PORT)
        if state is None:
            # 通话已结束
            break
        time.sleep(1)

    # 挂断 + 停止录音
    recorder.stop()
    hangup()

    # 更新通话记录
    contact = contact_identify(phone)
    if contact:
        contact_increment_call(phone)
    # 保存通话记录
    call_save(phone, 'outbound', 0, recording_path=rec_path, quality_ok=True)
    log.info(f"✅ 外呼完成，录音: {rec_path}")
    return True


def play_audio_to_call(wav_path: str) -> bool:
    """
    播放WAV文件给当前通话对方
    （通过HDMI → 3.5mm → 模块MIC）
    """
    if not os.path.exists(wav_path):
        log.error(f"文件不存在: {wav_path}")
        return False

    device = config['audio']['output_device']
    try:
        proc = subprocess.run([
            'ffmpeg', '-y', '-i', wav_path,
            '-ar', '48000', '-ac', '2',
            '-f', 'alsa', device
        ], capture_output=True, timeout=30)
        if proc.returncode == 0:
            log.info(f"音频播放成功: {wav_path}")
            return True
        else:
            log.error(f"音频播放失败: {proc.stderr[-100:]}")
            return False
    except Exception as e:
        log.error(f"音频播放异常: {e}")
        return False


def play_tts_to_call(text: str) -> bool:
    """播放TTS给当前通话对方"""
    return tts_and_play(text, device=config['audio']['output_device'])
