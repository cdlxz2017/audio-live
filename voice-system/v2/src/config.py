"""
config.py - 4G语音通讯系统 v2 配置管理
所有配置从 config.yaml 读取，API Key 不硬编码
"""
import os
import yaml
from pathlib import Path

# ── 路径配置 ─────────────────────────────────────────
BASE_DIR = Path('/home/ai/.openclaw/workspace/voice-system/v2')
LOG_DIR = Path('/home/ai/.openclaw/workspace/logs/voice-v2')
RECORDINGS_IN = Path('/home/ai/.openclaw/workspace/voice-system/recordings/inbound')
RECORDINGS_OUT = Path('/home/ai/.openclaw/workspace/voice-system/recordings/outbound')
CONFIG_FILE = BASE_DIR / 'config.yaml'

LOG_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_IN.mkdir(parents=True, exist_ok=True)
RECORDINGS_OUT.mkdir(parents=True, exist_ok=True)

# ── 默认配置 ─────────────────────────────────────────
DEFAULT_CONFIG = {
    'database': {
        'url': 'postgresql://openclaw_ai:zyxrcy910128@localhost:5432/openclaw_memory',
    },
    'serial': {
        'at_port': '/dev/ttyUSB1',
        'sms_port': '/dev/ttyUSB2',
        'baud': 115200,
    },
    'audio': {
        'record_device': 'plughw:1,0',
        'output_device': 'plughw:0,3',
        'sample_rate': 16000,
        'gain': 0.3,          # 录音增益，修复clipping
        'channels': 1,
    },
    'whisper': {
        'model': 'large-v3-turbo',
    },
    'llm': {
        'provider': 'minimax',
        'api_key': 'YOUR_MINIMAX_API_KEY',  # 替换为实际Key
        'model': 'MiniMax-M2.7',
        'base_url': 'https://api.minimax.chat/v1',
    },
    'tts': {
        'provider': 'edge',
        'voice': 'zh-CN-YunxiNeural',
    },
    'wechat': {
        'target': 'o9cq809401Af26gJM8UaJGc6KjBo@im.wechat',
        'channel': 'openclaw-weixin',
    },
}


def load_config() -> dict:
    """加载配置，缺失字段使用默认值"""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            user = yaml.safe_load(f) or {}
    else:
        user = {}

    # 深度合并默认值
    cfg = DEFAULT_CONFIG.copy()
    for section, values in user.items():
        if section in cfg and isinstance(cfg[section], dict):
            cfg[section] = {**cfg[section], **values}
        else:
            cfg[section] = values

    return cfg


config = load_config()
