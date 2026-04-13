#!/usr/bin/env python3
"""
通话摘要推送脚本（由 listener 呼叫，仅做 LLM摘要 + 微信推送）
用法: push_call_summary.py <caller> <duration> <transcript> <wav_path>
"""
import sys, json, subprocess, urllib.request, urllib.error, os, tempfile

LLM_API = 'https://api.deepseek.com/v1'
LLM_KEY = 'sk-b8ea3f548e574d42aaa527ba07318aca'
LLM_MODEL = 'deepseek-chat'
WECHAT_TARGET = 'o9cq809401Af26gJM8UaJGc6KjBo@im.wechat'

def llm_summary(text, caller, duration):
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
            return data['choices'][0]['message']['content'].strip()
    except Exception as e:
        print(f"[LLM] 失败: {e}", flush=True)
        return f"通话{duration}秒，内容：{text[:100]}"

def denoise_audio(wav_path):
    """降噪处理（暂时禁用，保持原有流程稳定）"""
    return wav_path  # 直接返回原始文件，跳过降噪

def push_wechat(caller, duration, summary, transcript, wav_path):
    msg = f"""📞 来电摘要
━━━━━━━━━━━━━━━
号码：{caller}
时长：{duration} 秒
━━━━━━━━━━━━━━━
{summary}
━━━━━━━━━━━━━━━
转写：
{transcript[:300]}{'...' if len(transcript) > 300 else ''}"""

    # 构建 openclaw message send 命令（文字 + 音频附件）
    cmd = [
        'openclaw', 'message', 'send',
        '--channel', 'openclaw-weixin',
        '--target', WECHAT_TARGET,
        '--message', msg
    ]
    if wav_path:
        cmd += ['--media', wav_path]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0 and 'Sent' in result.stdout:
            print("[微信] 推送成功", flush=True)
            return True
        else:
            print(f"[微信] 失败: {result.stderr or result.stdout}", flush=True)
            return False
    except Exception as e:
        print(f"[微信] 推送异常: {e}", flush=True)
        return False

if __name__ == '__main__':
    caller = sys.argv[1] if len(sys.argv) > 1 else ''
    duration = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    transcript = sys.argv[3] if len(sys.argv) > 3 else ''
    wav_path = sys.argv[4] if len(sys.argv) > 4 else ''

    print(f"[推送] 开始处理: {caller} {duration}s", flush=True)
    summary = llm_summary(transcript, caller, duration)
    denoised = denoise_audio(wav_path)
    push_wechat(caller, duration, summary, transcript, denoised)
    # 清理临时降噪文件
    if denoised != wav_path and os.path.exists(denoised):
        os.unlink(denoised)
    print("[推送] 完成", flush=True)
