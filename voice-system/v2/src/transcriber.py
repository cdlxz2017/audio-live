"""
transcriber.py - Whisper本地转写（GPU加速）
"""
import os
import logging
import whisper
from src.config import config

log = logging.getLogger('voice.transcriber')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    filename='/home/ai/.openclaw/workspace/logs/voice-v2/transcriber.log'
)

WHISPER_MODEL = config['whisper']['model']
_model_cache = None


def get_model():
    global _model_cache
    if _model_cache is None:
        log.info(f"加载Whisper模型: {WHISPER_MODEL}")
        _model_cache = whisper.load_model(WHISPER_MODEL)
    return _model_cache


def transcribe(wav_path: str, language: str = 'zh') -> str:
    """
    Whisper转写，返回文字内容
    """
    if not os.path.exists(wav_path):
        log.error(f"文件不存在: {wav_path}")
        return "(文件不存在)"

    try:
        model = get_model()
        log.info(f"Whisper转写中: {wav_path}")
        result = model.transcribe(
            wav_path,
            language=language,
            initial_prompt='电话通话内容，请尽量识别说话人'
        )
        text = result['text'].strip()
        log.info(f"转写完成: {len(text)}字")
        return text or "(无语音内容)"
    except Exception as e:
        log.error(f"Whisper转写失败: {e}")
        return f"(转写失败: {e})"
