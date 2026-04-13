"""
summarizer.py - LLM摘要（MiniMax API）
"""
import json
import logging
import urllib.request
from src.config import config

log = logging.getLogger('voice.summarizer')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    filename='/home/ai/.openclaw/workspace/logs/voice-v2/summarizer.log'
)


def summarize(text: str, caller: str, duration: int) -> str:
    """
    使用LLM生成通话摘要
    """
    cfg = config['llm']
    prompt = f"""电话通话记录摘要任务。

通话信息：
- 来电号码：{caller}
- 通话时长：{duration} 秒

通话内容转写：
{text}

请生成一段简洁的中文摘要，包括：
1. 通话主题/目的
2. 关键信息
3. 后续行动建议（如有）

直接输出摘要正文，不需要标题。"""

    try:
        if cfg.get('provider') == 'minimax':
            return _summarize_minimax(prompt, cfg)
        elif cfg.get('provider') == 'deepseek':
            return _summarize_deepseek(prompt, cfg)
        else:
            return _summarize_minimax(prompt, cfg)
    except Exception as e:
        log.error(f"摘要生成失败: {e}")
        return f"通话{duration}秒，内容：{text[:100] if text else '(无转写)'}"


def _summarize_minimax(prompt: str, cfg: dict) -> str:
    url = f"{cfg['base_url']}/text/chatcompletion_v2"
    payload = {
        "model": cfg.get('model', 'MiniMax-M2.7'),
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 300,
        "temperature": 0.3
    }
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {cfg["api_key"]}'
    }
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers, method='POST'
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
        return data['choices'][0]['message']['content'].strip()


def _summarize_deepseek(prompt: str, cfg: dict) -> str:
    url = f"{cfg.get('base_url', 'https://api.deepseek.com/v1')}/chat/completions"
    payload = {
        "model": cfg.get('model', 'deepseek-chat'),
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 300,
        "temperature": 0.3
    }
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {cfg["api_key"]}'
    }
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers=headers, method='POST'
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
        return data['choices'][0]['message']['content'].strip()
