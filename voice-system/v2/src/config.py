"""
config.py - 4G语音通讯系统 v2 配置管理
所有配置从 config.yaml 读取，API Key + 硬件端口自动检测，不硬编码
"""
import os
import json
import yaml
import serial
import subprocess
import glob
from pathlib import Path

# ── 路径配置 ─────────────────────────────────────────
BASE_DIR = Path('/home/ai/.openclaw/workspace/voice-system/v2')
LOG_DIR = Path('/home/ai/.openclaw/workspace/logs/voice-v2')
RECORDINGS_IN = Path('/home/ai/.openclaw/workspace/voice-system/recordings/inbound')
RECORDINGS_OUT = Path('/home/ai/.openclaw/workspace/voice-system/recordings/outbound')
CONFIG_FILE = BASE_DIR / 'config.yaml'
OPENCLAW_CONFIG = Path('/home/ai/.openclaw/openclaw.json')

LOG_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_IN.mkdir(parents=True, exist_ok=True)
RECORDINGS_OUT.mkdir(parents=True, exist_ok=True)


# ── MiniMax API Key 自动从 OpenClaw 配置读取 ─────────
def detect_minimax_api_key() -> str:
    """从 OpenClaw openclaw.json 读取 MiniMax API Key"""
    try:
        if OPENCLAW_CONFIG.exists():
            with open(OPENCLAW_CONFIG, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            providers = cfg.get('models', {}).get('providers', {})
            for name, p in providers.items():
                if name == 'minimax' and p.get('apiKey'):
                    return p['apiKey']
    except Exception:
        pass
    return None


# ── 硬件端口自动检测 ─────────────────────────────────
def detect_at_port() -> str:
    """扫描 /dev/ttyUSB* ，发送 AT 验证，返回真实可用端口"""
    candidates = sorted(glob.glob('/dev/ttyUSB*'))
    for port in candidates:
        try:
            ser = serial.Serial(port, 115200, timeout=2)
            ser.write(b'AT\\r\\n')
            ser.flush()
            time.sleep(0.5)
            resp = ser.read(256).decode('utf-8', errors='ignore')
            ser.close()
            if 'OK' in resp:
                print(f"[硬件检测] AT命令口: {port}")
                return port
        except Exception:
            pass
    # 兜底：使用常见默认端口
    print(f"[硬件检测] 未扫描到可用AT口，使用默认 /dev/ttyUSB1")
    return '/dev/ttyUSB1'


def detect_sms_port() -> str:
    """扫描 /dev/ttyUSB* ，发送 AT+CMGF=0 验证SMS口（与AT口不同）"""
    candidates = sorted(glob.glob('/dev/ttyUSB*'))
    for port in candidates:
        # 短信口通常与AT口分开，先尝试发送SMS相关AT
        try:
            ser = serial.Serial(port, 115200, timeout=2)
            ser.write(b'AT+CMGF=0\\r\\n')  # PDU模式
            ser.flush()
            time.sleep(0.5)
            resp = ser.read(256).decode('utf-8', errors='ignore')
            ser.close()
            if 'OK' in resp or 'ERROR' in resp:
                # 有响应说明是GSM模块（AT或SMS口）
                print(f"[硬件检测] SMS/AT候选口: {port}")
                return port
        except Exception:
            pass
    print(f"[硬件检测] 未扫描到SMS口，使用默认 /dev/ttyUSB2")
    return '/dev/ttyUSB2'


def detect_audio_devices() -> dict:
    """解析 arecord -l 输出，自动识别 USB 录音设备"""
    result = {
        'record_device': 'plughw:1,0',  # 默认
        'output_device': 'plughw:0,3',  # 默认（HDMI）
    }
    try:
        out = subprocess.check_output(['arecord', '-l'], text=True, timeout=5)
        for line in out.splitlines():
            if 'card' in line and ('USB' in line or 'Device' in line):
                # 例: "card 1: Device [USB Device], device 0: USB Audio [USB Audio]"
                m = re.search(r'card (\d+).*?device (\d+):\s*(.+?)\s*\[(.+?)\]', line)
                if m:
                    card, dev, devname, typename = m.groups()
                    # USB 设备优先
                    if 'USB' in typename or 'UAC' in typename:
                        result['record_device'] = f'plughw:{card},{dev}'
                        print(f"[硬件检测] 录音设备: {line.strip()}")
                        break
    except Exception as e:
        print(f"[硬件检测] arecord -l 失败: {e}")

    # TTS播放设备固定用 HDMI (plughw:0,3)
    try:
        out = subprocess.check_output(['aplay', '-l'], text=True, timeout=5)
        for line in out.splitlines():
            if 'card' in line and 'HDMI' in line:
                m = re.search(r'card (\d+).*?device (\d+):', line)
                if m:
                    result['output_device'] = f'plughw:{m.group(1)},{m.group(2)}'
                    print(f"[硬件检测] TTS播放设备: {line.strip()}")
                    break
    except Exception:
        pass

    return result


import time
import re

# ── 默认配置（启动时会被自动检测值覆盖）────────────────
DEFAULT_CONFIG = {
    'database': {
        'url': 'postgresql://openclaw_ai:zyxrcy910128@localhost:5432/openclaw_memory',
    },
    'serial': {
        'at_port': None,       # 自动检测
        'sms_port': None,      # 自动检测
        'baud': 115200,
    },
    'audio': {
        'record_device': None,  # 自动检测
        'output_device': None,  # 自动检测
        'sample_rate': 16000,
        'gain': 0.3,
        'channels': 1,
    },
    'whisper': {
        'model': 'large-v3-turbo',
    },
    'llm': {
        'provider': 'minimax',
        'api_key': None,        # 自动从 OpenClaw 配置读取
        'model': 'MiniMax-M2.7',
        'base_url': 'https://api.minimaxi.com/anthropic',
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
    """加载配置，缺失字段使用默认值，API Key 和硬件端口自动检测"""
    # 1. 加载 yaml
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            user = yaml.safe_load(f) or {}
    else:
        user = {}

    # 2. 深度合并默认值
    cfg = DEFAULT_CONFIG.copy()
    for section, values in user.items():
        if section in cfg and isinstance(cfg[section], dict):
            cfg[section] = {**cfg[section], **values}
        else:
            cfg[section] = values

    # 3. MiniMax API Key：优先 yaml，其次自动检测
    if not cfg['llm']['api_key']:
        auto_key = detect_minimax_api_key()
        if auto_key:
            cfg['llm']['api_key'] = auto_key
            print(f"[配置] MiniMax API Key: 已从 OpenClaw 配置自动加载")
        else:
            print("[配置] 警告: 未找到 MiniMax API Key，LLM 摘要功能将不可用")

    # 4. 硬件端口自动检测（yaml 有值则用 yaml，否则自动检测）
    if not cfg['serial'].get('at_port'):
        cfg['serial']['at_port'] = detect_at_port()
    if not cfg['serial'].get('sms_port'):
        cfg['serial']['sms_port'] = detect_sms_port()

    audio_detected = detect_audio_devices()
    if not cfg['audio'].get('record_device'):
        cfg['audio']['record_device'] = audio_detected['record_device']
    if not cfg['audio'].get('output_device'):
        cfg['audio']['output_device'] = audio_detected['output_device']

    return cfg


config = load_config()
