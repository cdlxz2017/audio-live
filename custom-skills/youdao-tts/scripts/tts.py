#!/usr/bin/env python3
"""
有道+Edge TTS 混合脚本
优先使用有道TTS（有app secret），失败则使用 edge-tts（免费）
用法: python3 tts.py "文字" [输出路径]
"""

import sys
import os
import tempfile
import subprocess

VENV_BIN = "/home/ai/ocr-env/bin"
EDGE_TTS = f"{VENV_BIN}/edge-tts"

def tts_edge(text, output_path):
    """使用 edge-tts 生成语音"""
    try:
        result = subprocess.run(
            [EDGE_TTS, "-t", text, "--write-media", output_path],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0 and os.path.exists(output_path):
            return True, output_path
        return False, result.stderr
    except Exception as e:
        return False, str(e)

def main():
    if len(sys.argv) < 2:
        print("用法: python3 tts.py \"文字\" [输出路径]")
        sys.exit(1)

    text = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    if not output_path:
        fd, output_path = tempfile.mkstemp(suffix=".mp3")
        os.close(fd)

    print(f"🎤 正在合成: {text[:50]}...", file=sys.stderr)

    success, result = tts_edge(text, output_path)
    if success:
        size = os.path.getsize(output_path)
        print(f"✅ 成功: {output_path} ({size} bytes)", file=sys.stderr)
        print(output_path)
    else:
        print(f"❌ 失败: {result}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
