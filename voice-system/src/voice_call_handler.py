#!/usr/bin/env python3
"""
Voice Call Handler - 通话处理主管
监听通话事件 → 录制 → 转写 → 摘要 → 推送微信

用法:
  python3 -m voice_system.src.voice_call_handler <wav_path> <caller> <duration>
  或直接: python3 voice_call_handler.py <wav_path> <caller> <duration>
"""

import sys
import os
import subprocess
import json
import re
import urllib.request
import urllib.error
from datetime import datetime

# ── 路径配置 ───────────────────────────────────────
VOICE_SYS = '/home/ai/.openclaw/workspace/voice-system'
os.makedirs(os.path.join(VOICE_SYS, 'recordings'), exist_ok=True)
os.makedirs(os.path.join(VOICE_SYS, 'data'), exist_ok=True)
os.makedirs('/home/ai/.openclaw/workspace/logs', exist_ok=True)

# ── Whisper（直接import，避免subprocess嵌套）────────────
def transcribe_whisper(wav_path: str) -> str:
    """本地 Whisper 转写"""
    print(f"[Whisper] 转写中: {wav_path}", flush=True)
    try:
        import whisper
        model = whisper.load_model('base')
        result = model.transcribe(wav_path, language='zh', initial_prompt='电话通话内容')
        text = result['text'].strip()
        if not text:
            text = "(转写无结果)"
        print(f"[Whisper] 结果: {text[:80]}", flush=True)
        return text
    except Exception as e:
        print(f"[Whisper] 失败: {e}", flush=True)
        return "(转写失败)"

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
        return f"通话{duration}秒，内容：{text[:100] if text else '(无转写)'}"

# ── 微信推送 ─────────────────────────────────────────
WECHAT_TARGET = 'o9cq809401Af26gJM8UaJGc6KjBo@im.wechat'

def push_wechat(caller: str, duration: int, summary: str, transcript: str):
    msg = f"""📞 来电摘要
━━━━━━━━━━━━━━━
号码：{caller}
时长：{duration} 秒
━━━━━━━━━━━━━━━
{summary}
━━━━━━━━━━━━━━━
转写：
{transcript[:300]}{'...' if len(transcript) > 300 else ''}"""

    try:
        result = subprocess.run([
            'openclaw', 'message', 'send',
            '--channel', 'openclaw-weixin',
            '--target', WECHAT_TARGET,
            '--message', msg
        ], capture_output=True, text=True, timeout=15)
        if result.returncode == 0 and 'Sent' in result.stdout:
            print(f"[微信] 推送成功", flush=True)
            return True
        else:
            print(f"[微信] 推送失败: {result.stderr or result.stdout}", flush=True)
            return False
    except Exception as e:
        print(f"[微信] 推送异常: {e}", flush=True)
        return False

# ── 主处理流程 ───────────────────────────────────────
def process_call(wav_path: str, caller: str, duration: int):
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')

    print(f"\n{'='*50}", flush=True)
    print(f"[流程] 开始处理 | {caller} | {duration}s | {os.path.basename(wav_path)}", flush=True)
    print(f"{'='*50}", flush=True)

    transcript = transcribe_whisper(wav_path)
    summary = summarize(transcript, caller, duration)
    push_wechat(caller, duration, summary, transcript)

    log_file = os.path.join(VOICE_SYS, 'data', 'calls.jsonl')
    record = {
        "ts": ts,
        "caller": caller,
        "duration": duration,
        "transcript": transcript,
        "summary": summary,
        "wav": wav_path,
        "tag": "inbound"
    }
    with open(log_file, 'a') as f:
        f.write(json.dumps(record, ensure_ascii=False) + '\n')

    print(f"[完成] 通话处理完毕", flush=True)
    return record

# ── 入口 ─────────────────────────────────────────────
if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("用法: voice_call_handler.py <wav_path> <caller> <duration>")
        sys.exit(1)

    wav_path = sys.argv[1]
    caller = sys.argv[2]
    duration = int(sys.argv[3])

    if not os.path.exists(wav_path):
        print(f"[错误] 录音文件不存在: {wav_path}")
        sys.exit(1)

    process_call(wav_path, caller, duration)
