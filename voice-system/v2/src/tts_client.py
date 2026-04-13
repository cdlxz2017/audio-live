"""
tts_client.py - Edge-TTS 封装（TTS生成WAV）
"""
import subprocess
import logging
import os
import tempfile
from src.config import config

log = logging.getLogger('voice.tts')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    filename='/home/ai/.openclaw/workspace/logs/voice-v2/tts.log'
)

TTS_CFG = config['tts']
VOICE = TTS_CFG.get('voice', 'zh-CN-YunxiNeural')


def generate_tts(text: str, output_path: str = None) -> str:
    """
    用Edge-TTS生成语音WAV文件
    返回文件路径
    """
    if output_path is None:
        output_path = tempfile.mktemp(suffix='.wav')

    try:
        # Edge-TTS: edge-tts --voice <voice> --text "<text>" --write-media <output>
        result = subprocess.run([
            'edge-tts',
            '--voice', VOICE,
            '--text', text,
            '--write-media', output_path
        ], capture_output=True, text=True, timeout=30)

        if result.returncode == 0 and os.path.exists(output_path):
            log.info(f"TTS生成成功: {output_path}")
            return output_path
        else:
            log.error(f"TTS生成失败: {result.stderr}")
            return None
    except FileNotFoundError:
        log.error("edge-tts 命令未找到，请安装: pip install edge-tts")
        return None
    except Exception as e:
        log.error(f"TTS生成异常: {e}")
        return None


def tts_and_play(text: str, device: str = None) -> bool:
    """
    生成TTS并立即播放到指定设备
    用于外呼时播放给通话对方（通过HDMI → 3.5mm → 模块MIC）
    """
    wav_path = generate_tts(text)
    if not wav_path:
        return False

    device = device or config['audio']['output_device']
    try:
        # ffmpeg转换格式后播放
        proc = subprocess.run([
            'ffmpeg', '-y', '-i', wav_path,
            '-ar', '48000', '-ac', '2',
            '-f', 'alsa', device
        ], capture_output=True, timeout=30)
        if proc.returncode == 0:
            log.info(f"TTS播放成功: {text[:30]}")
            return True
        else:
            log.error(f"TTS播放失败: {proc.stderr[-100:]}")
            return False
    except Exception as e:
        log.error(f"TTS播放异常: {e}")
        return False
