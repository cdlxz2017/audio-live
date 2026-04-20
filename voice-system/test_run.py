#!/usr/bin/env python3
import sys
import os
import subprocess
import json
import re
from datetime import datetime

# ── 路径配置 ───────────────────────────────────────
VOICE_SYS = '/home/ai/.openclaw/workspace/voice-system'
RECORDINGS = os.path.join(VOICE_SYS, 'recordings')
os.makedirs(RECORDINGS, exist_ok=True)

# ── Whisper ─────────────────────────────────────────
WHISPER_MODEL = 'base'

def transcribe_whisper(wav_path: str) -> str:
    print(f"[Whisper] 转写中: {wav_path}", flush=True)
    result = subprocess.run([
        'python3', '-c',
        f"""
import whisper
model = whisper.load_model('{WHISPER_MODEL}')
result = model.transcribe('{wav_path}', language='zh', initial_prompt='电话通话内容')
print(result['text'])
"""
    ], capture_output=True, text=True, timeout=120)
    text = result.stdout.strip()
    print(f"[Whisper] 结果: {text[:80]}", flush=True)
    return text

# ── LLM 摘要 ─────────────────────────────────────────
LLM_API = 'https://api.deepseek.com/v1'
LLM_KEY = 'sk-b8ea3f548e574d42aaa527ba07318aca'
LLM_MODEL = 'deepseek-chat'

def summarize(text: str, caller: str, duration: int) -> str:
    print(f"[LLM] 生成摘要中...", flush=True)
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

    import urllib.request

    payload = {
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 300,
        "temperature": 0.3
    }

    try:
        req = urllib.request.Request(
            f"{LLM_API}/chat/completions",
            data=json.dumps(payload).encode(),
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {LLM_KEY}'
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            summary = data['choices'][0]['message']['content'].strip()
            print(f"[LLM] 摘要: {summary[:80]}", flush=True)
            return summary
    except Exception as e:
        print(f"[LLM] 失败: {e}", flush=True)
        return f"通话{duration}秒，内容：{text[:100]}"

# ── 微信推送 ─────────────────────────────────────────
WECHAT_TARGET = 'o9cq809401Af26gJM8UaJGc6KjBo@im.wechat'

def push_wechat(caller: str, duration: int, summary: str, transcript: str):
    import urllib.request

    msg = f"""📞 来电摘要
━━━━━━━━━━━━━━━
号码：{caller}
时长：{duration} 秒
━━━━━━━━━━━━━━━
{summary}
━━━━━━━━━━━━━━━
转写：
{transcript[:300]}{'...' if len(transcript) > 300 else ''}"""

    payload = {
        "action": "send",
        "channel": "openclaw-weixin",
        "target": WECHAT_TARGET,
        "message": msg
    }

    try:
        req = urllib.request.Request(
            'http://localhost:18789/api/message',
            data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[微信] 推送成功", flush=True)
            return True
    except Exception as e:
        print(f"[微信] 推送失败: {e}", flush=True)
        return False

# ── 主处理流程 ────────────────────────────────────────
def process_call(wav_path: str, caller: str, duration: int):
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    tag = 'inbound'

    print(f"\n{'='*50}", flush=True)
    print(f"[流程] 开始处理通话 | {caller} | {duration}s", flush=True)
    print(f"{'='*50}", flush=True)

    transcript = transcribe_whisper(wav_path)
    summary = summarize(transcript, caller, duration)
    push_wechat(caller, duration, summary, transcript)

    log_file = os.path.join(VOICE_SYS, 'data', 'calls.jsonl')
    os.makedirs(os.path.dirname(log_file), exist_ok=True)
    record = {
        "ts": ts,
        "caller": caller,
        "duration": duration,
        "transcript": transcript,
        "summary": summary,
        "wav": wav_path,
        "tag": tag
    }
    with open(log_file, 'a') as f:
        f.write(json.dumps(record, ensure_ascii=False) + '\n')

    print(f"[完成] 通话处理完毕", flush=True)
    return record

if __name__ == '__main__':
    wav = '/home/ai/.openclaw/workspace/voice-system/recordings/inbound/test_sample.wav'
    os.makedirs(os.path.dirname(wav), exist_ok=True)
    import shutil
    shutil.copy('/tmp/bidirectional_test.wav', wav)
    process_call(wav, '测试号码', 49)
