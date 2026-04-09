#!/usr/bin/env python3
"""邮件发送模块 - 复用已有的 send-email skill，支持附件"""
import subprocess
import os
import sys

def send_video_email(to_addr, video_filename, transcript, summary, duration_sec, transcript_file, summary_file, lat=None, lng=None, location_name=None):
    """发送视频转写+摘要邮件，带附件"""
    duration_min = duration_sec // 60
    duration_sec_rem = duration_sec % 60
    location_lines = ""
    if lat and lng:
        location_lines += f"\n坐标：{lat}°N, {lng}°E"
    if location_name:
        location_lines += f"\n位置：{location_name}"
    subject = f"【音频摘要】{video_filename}"
    body = f"""您好，

音频录制已完成，附件包含：
- 转写文本 (.txt)
- 要点摘要 (.txt)

文件：{video_filename}
时长：{duration_min}分{duration_sec_rem}秒{location_lines}

--- 要点摘要 ---
{summary}

---
由 AI 助手自动发送"""

    script_path = "/home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-email.py"
    cmd = [
        "python3", script_path,
        "--to", to_addr,
        "--subject", subject,
        "--body", body,
        "--attach", transcript_file,
        "--attach", summary_file
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return True, f"邮件已发送至 {to_addr}"
        else:
            return False, f"发送失败: {result.stderr}"
    except Exception as e:
        return False, f"邮件发送异常: {e}"

def main():
    if len(sys.argv) < 3:
        print("Usage: emailer.py send <to> <filename> <transcript_file> <summary_file> <duration_sec>")
        sys.exit(1)
    
    cmd_type = sys.argv[1]
    
    if cmd_type == "send" and len(sys.argv) >= 6:
        to = sys.argv[2]
        filename = sys.argv[3]
        transcript_file = sys.argv[4]
        summary_file = sys.argv[5]
        duration = int(sys.argv[6])
        lat = float(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7] else None
        lng = float(sys.argv[8]) if len(sys.argv) > 8 and sys.argv[8] else None
        location_name = sys.argv[9] if len(sys.argv) > 9 and sys.argv[9] else None
        summary = ""
        if os.path.exists(summary_file):
            with open(summary_file, "r", encoding="utf-8") as f:
                summary = f.read().strip()
        transcript = ""
        if os.path.exists(transcript_file):
            with open(transcript_file, "r", encoding="utf-8") as f:
                transcript = f.read().strip()
        ok, msg = send_video_email(to, filename, transcript, summary, duration, transcript_file, summary_file, lat, lng, location_name)
        print(f"{'OK' if ok else 'ERROR'}:{msg}")
    else:
        print("Usage: emailer.py send <to> <filename> <transcript_file> <summary_file> <duration_sec> [lat] [lng] [location_name]")

if __name__ == "__main__":
    main()
