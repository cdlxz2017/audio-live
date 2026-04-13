"""
audio_recorder.py - 录音模块（增益控制 + 质量检测）
关键修复：-v 0.3 增益控制防clipping，16kHz采样率
"""
import subprocess
import os
import logging
from pathlib import Path
from src.config import config

log = logging.getLogger('voice.recorder')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    filename='/home/ai/.openclaw/workspace/logs/voice-v2/recorder.log'
)

AUDIO_CFG = config['audio']
REC_DEVICE = AUDIO_CFG['record_device']
SAMPLE_RATE = AUDIO_CFG.get('sample_rate', 16000)
GAIN = AUDIO_CFG.get('gain', 0.3)  # 0.3 = 30%，防clipping
CHANNELS = AUDIO_CFG.get('channels', 1)


class AudioRecorder:
    def __init__(self, output_path: str):
        self.output_path = output_path
        self.proc = None

    def start(self) -> bool:
        """开始录音"""
        try:
            if self.proc:
                self.stop()

            cmd = [
                'arecord',
                '-D', REC_DEVICE,
                '-f', 'S16_LE',
                '-r', str(SAMPLE_RATE),
                '-c', str(CHANNELS),
                '-v', str(GAIN),      # 关键：增益控制，防clipping
                self.output_path
            ]
            log.info(f"录音开始: {' '.join(cmd)}")
            self.proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            return True
        except Exception as e:
            log.error(f"录音启动失败: {e}")
            return False

    def stop(self) -> bool:
        """停止录音"""
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            log.info("录音停止")
            self.proc = None
        return True

    def is_recording(self) -> bool:
        return self.proc is not None and self.proc.poll() is None


def detect_quality(wav_path: str) -> dict:
    """
    使用ffmpeg volumedetect检测录音质量
    返回: {quality_ok: bool, max_volume: float, mean_volume: float}
    """
    result = {
        'quality_ok': True,
        'max_volume': -60.0,
        'mean_volume': -60.0,
    }
    try:
        proc = subprocess.run([
            'ffmpeg', '-y', '-i', wav_path,
            '-af', 'volumedetect',
            '-f', 'null', '/dev/null'
        ], capture_output=True, text=True, timeout=30)

        output = proc.stderr + proc.stdout

        import re
        m_max = re.search(r'max_volume:\s*([-\d.]+)\s*dB', output)
        m_mean = re.search(r'mean_volume:\s*([-\d.]+)\s*dB', output)

        if m_max:
            result['max_volume'] = float(m_max.group(1))
        if m_mean:
            result['mean_volume'] = float(m_mean.group(1))

        # 标记失真：max_volume > -1dB 表示有clipping风险
        result['quality_ok'] = result['max_volume'] <= -1.0
        if not result['quality_ok']:
            log.warning(f"录音失真检测: max_volume={result['max_volume']}dB > -1dB")

    except Exception as e:
        log.error(f"质量检测失败: {e}")

    return result


def normalize_audio(wav_path: str, target_db: float = -3.0) -> str:
    """
    用ffmpeg loudnorm标准化音频到目标dB峰值
    返回标准化后的文件路径
    """
    normalized = wav_path + '.norm.wav'
    try:
        proc = subprocess.run([
            'ffmpeg', '-y', '-i', wav_path,
            '-af', f'loudnorm=I={target_db}:TP=-1.5:LRA=11',
            '-ar', str(SAMPLE_RATE), '-ac', str(CHANNELS),
            normalized
        ], capture_output=True, timeout=30)
        if proc.returncode == 0:
            os.replace(normalized, wav_path)
            log.info(f"音频标准化完成: {wav_path}")
        else:
            log.error(f"音频标准化失败: {proc.stderr[-100:]}")
    except Exception as e:
        log.error(f"音频标准化异常: {e}")
    return wav_path


def prepare_audio_for_whisper(wav_path: str) -> str:
    """
    预处理录音：16kHz单声道，为Whisper准备
    返回处理后的文件路径（原位覆盖）
    """
    processed = wav_path + '.16k.wav'
    try:
        proc = subprocess.run([
            'ffmpeg', '-y', '-i', wav_path,
            '-ar', '16000', '-ac', '1',
            '-acodec', 'pcm_s16le',
            processed
        ], capture_output=True, timeout=30)
        if proc.returncode == 0:
            os.replace(processed, wav_path)
        else:
            log.error(f"音频预处理失败: {proc.stderr[-100:]}")
    except Exception as e:
        log.error(f"音频预处理异常: {e}")
    return wav_path
