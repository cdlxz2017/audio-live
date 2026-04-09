#!/usr/bin/env python3
"""
视频转写摘要生成器 - 调用 LLM 从转写文本生成要点摘要
"""
import sys
import os
import json
import urllib.request
import urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# LLM 配置（复用 tech-knowledge 的提取模型）
LLM_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
LLM_API_KEY = "sk-50c8c0524a8244ffbdcb9131545dfa56"  # 已配置在环境中
LLM_MODEL = "qwen-max"

def summarize_transcript(transcript: str, video_name: str = "") -> str:
    """调用 LLM 生成要点摘要"""
    
    prompt = f"""你是一个会议记录助手。请根据以下视频转写内容，生成简明的要点摘要。

要求：
- 提炼核心主题和关键内容
- 按逻辑分组，每组用一句话概括
- 列出重要的结论、决定或行动项（如果有）
- 语言：中文，简练

转写内容：
{transcript}

要点摘要："""

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 1024,
        "temperature": 0.3
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        LLM_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {LLM_API_KEY}",
            "Content-Type": "application/json"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        return f"[摘要生成失败: HTTP {e.code}]"
    except Exception as e:
        return f"[摘要生成失败: {e}]"

def main():
    if len(sys.argv) < 2:
        print("Usage: summarizer.py <transcript_file> [output_summary_file]")
        sys.exit(1)

    transcript_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else transcript_file.replace(".txt", "_摘要.txt")

    with open(transcript_file, "r", encoding="utf-8") as f:
        transcript = f.read().strip()

    if not transcript:
        print("[摘要] 转写内容为空，跳过")
        sys.exit(0)

    print(f"[摘要] 开始生成要点 ({len(transcript)} 字符)...")
    summary = summarize_transcript(transcript)
    
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(summary)

    print(f"[摘要] 已保存: {output_file}")
    print(summary)
    return summary

if __name__ == "__main__":
    main()
