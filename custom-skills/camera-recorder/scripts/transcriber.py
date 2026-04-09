#!/usr/bin/env python3
"""
语音转写模块 - 支持多 ASR 引擎回退：
  1. 阿里云 DashScope Fun-ASR（百炼）← 主用
  2. 本地 Whisper CLI（兜底）
"""
import subprocess
import os
import sys
import json
import requests

DASHSCOPE_API_KEY = 'sk-50c8c0524a8244ffbdcb9131545dfa56'


def upload_to_litterbox(audio_path):
    """上传音频到 litterbox.catbox.moe，返回 HTTPS URL（72小时有效）"""
    try:
        with open(audio_path, 'rb') as f:
            resp = requests.post(
                'https://litterbox.catbox.moe/resources/internals/api.php',
                files={'fileToUpload': (os.path.basename(audio_path), f, 'audio/mpeg')},
                data={'reqtype': 'fileupload', 'time': '72h'},
                timeout=60
            )
        if resp.status_code == 200 and resp.text.strip().startswith('https://'):
            url = resp.text.strip()
            print(f"[转写] 已上传: {url}", file=sys.stderr)
            return url
        return None
    except Exception as e:
        print(f"[转写] 上传失败: {e}", file=sys.stderr)
        return None


def transcribe_with_dashscope(audio_path):
    """使用阿里云 DashScope Fun-ASR 转写"""
    # 1. 上传获取公开 URL
    audio_url = upload_to_litterbox(audio_path)
    if not audio_url:
        return False, "音频上传失败"

    # 2. 使用 DashScope Python SDK 提交转写任务
    try:
        import dashscope
        from dashscope.audio.asr import Transcription
        from http import HTTPStatus
        import urllib.request

        dashscope.api_key = DASHSCOPE_API_KEY
        dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'

        # 提交异步任务
        task_resp = Transcription.async_call(
            model='fun-asr',
            file_urls=[audio_url],
            language_hints=['zh']
        )
        if task_resp.status_code != HTTPStatus.OK:
            return False, f"提交失败: {task_resp.output.message if hasattr(task_resp, 'output') else task_resp}"

        task_id = task_resp.output.task_id
        print(f"[转写] 任务ID: {task_id}", file=sys.stderr)

        # 3. 等待转写完成（SDK 内部轮询）
        result = Transcription.wait(task=task_id)
        if result.status_code != HTTPStatus.OK:
            return False, f"等待失败: {result.output.message if hasattr(result, 'output') else result}"

        # 4. 解析结果
        for r in result.output.results:
            if r.get('subtask_status') == 'SUCCEEDED':
                result_url = r.get('transcription_url')
                if result_url:
                    with urllib.request.urlopen(result_url, timeout=30) as tr:
                        tr_data = json.load(tr)
                        texts = []
                        for ch in tr_data.get('transcripts', []):
                            txt = ch.get('text', '')
                            if txt:
                                texts.append(txt)
                        final_text = ' '.join(texts).strip()
                        if final_text:
                            return True, final_text
        return False, "未找到转写结果"

    except ImportError:
        return False, "dashscope SDK 未安装"
    except Exception as e:
        return False, f"DashScope 转写异常: {e}"


def transcribe_with_whisper_cli(audio_path, model="large-v3-turbo"):
    """使用本地 whisper CLI 转写（兜底）"""
    output_dir = os.path.dirname(audio_path) or "."
    base = os.path.splitext(audio_path)[0]
    txt_file = os.path.join(output_dir, os.path.basename(base) + ".txt")

    cmd = [
        "whisper", audio_path,
        "--model", model,
        "--model_dir", os.path.expanduser("~/.cache/whisper"),
        "--language", "zh",
        "--task", "transcribe",
        "--output_dir", output_dir,
        "--output_format", "txt",
        "--fp16", "False"
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            return False, f"Whisper 失败: {r.stderr[:300]}"
        if os.path.exists(txt_file):
            with open(txt_file, encoding="utf-8") as f:
                return True, f.read().strip()
        return False, "Whisper 未生成结果文件"
    except subprocess.TimeoutExpired:
        return False, "Whisper 超时（>10分钟）"
    except Exception as e:
        return False, f"Whisper 异常: {e}"


def transcribe(audio_path, model=None, output_dir=None):
    """主入口：先试 DashScope ASR，再用本地 Whisper"""
    if not os.path.exists(audio_path):
        return False, f"音频文件不存在: {audio_path}"

    print(f"[转写] 优先使用阿里云 DashScope Fun-ASR: {audio_path}", file=sys.stderr)
    ok, result = transcribe_with_dashscope(audio_path)
    if ok:
        print(f"[转写] DashScope ASR 成功: {len(result)} 字", file=sys.stderr)
        return True, result

    print(f"[转写] DashScope 失败，切换本地 Whisper: {result}", file=sys.stderr)
    return transcribe_with_whisper_cli(audio_path, model or "large-v3-turbo")


def main():
    if len(sys.argv) < 2:
        print("Usage: transcriber.py <audio_file> [model]", file=sys.stderr)
        sys.exit(1)
    audio = sys.argv[1]
    ok, result = transcribe(audio)
    if ok:
        print(f"OK:{result}")
    else:
        print(f"ERROR:{result}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
