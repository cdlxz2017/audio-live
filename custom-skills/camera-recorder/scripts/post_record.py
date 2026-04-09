#!/usr/bin/env python3
"""
录制后处理脚本 - 接收视频路径，完成：
  转写 → 写文件 → 摘要 → 写文件 → 更新数据库 → 发送邮件（带附件）
作为独立进程运行，不受主 session 影响
"""
import subprocess
import sys
import os
import psycopg2

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def main():
    if len(sys.argv) < 4:
        print("Usage: post_record.py <video_path> <duration_sec> <filename>")
        sys.exit(1)

    video_path = sys.argv[1]
    duration = int(sys.argv[2])
    filename = sys.argv[3]
    video_dir = os.path.dirname(video_path)

    # 1. 转写
    print("[后处理] 开始转写...")
    tsc_result = subprocess.run(
        ["python3", f"{SCRIPT_DIR}/transcriber.py", video_path],
        capture_output=True, text=True
    )
    if tsc_result.returncode != 0 or not tsc_result.stdout.strip():
        print(f"[后处理] ERROR: 转写失败: {tsc_result.stderr}")
        sys.exit(1)

    transcript = tsc_result.stdout.strip()
    print(f"[后处理] 转写完成: {len(transcript)} 字符")

    # 2. 转写文本写入文件
    transcript_file = os.path.join(video_dir, filename + ".txt")
    with open(transcript_file, "w", encoding="utf-8") as f:
        f.write(transcript)
    print(f"[后处理] 转写文件: {transcript_file}")

    # 3. 生成摘要
    print("[后处理] 开始生成摘要...")
    sum_result = subprocess.run(
        ["python3", f"{SCRIPT_DIR}/summarizer.py", transcript_file],
        capture_output=True, text=True
    )
    summary = ""
    if sum_result.returncode == 0:
        summary = sum_result.stdout.strip()
        print(f"[后处理] 摘要生成成功")
    else:
        print(f"[后处理] 摘要生成失败: {sum_result.stderr}")

    summary_file = transcript_file.replace(".txt", "_摘要.txt")

    # 4. 连接数据库
    conn = psycopg2.connect(
        host="localhost", port=5432,
        user="openclaw_ai", password="zyxrcy910128",
        database="openclaw_memory"
    )
    cur = conn.cursor()
    cur.execute(
        "SELECT id FROM video_records WHERE filepath=%s ORDER BY id DESC LIMIT 1",
        (video_path,)
    )
    row = cur.fetchone()
    if not row:
        print("[后处理] ERROR: 未找到数据库记录")
        conn.close()
        sys.exit(1)
    rid = row[0]

    # 5. 更新数据库
    cur.execute(
        "UPDATE video_records SET transcript=%s, transcript_status='done' WHERE id=%s",
        (transcript, rid)
    )
    conn.commit()

    # 6. 发送邮件（带附件）
    print("[后处理] 发送邮件...")
    emailer = subprocess.run(
        ["python3", f"{SCRIPT_DIR}/emailer.py", "send",
         "cdlxz2017@qq.com", filename, transcript_file, summary_file, str(duration)],
        capture_output=True, text=True
    )
    if emailer.returncode == 0:
        cur.execute(
            "UPDATE video_records SET email_sent=true, email_sent_at=NOW() WHERE id=%s",
            (rid,)
        )
        conn.commit()
        print(f"[后处理] ✅ 邮件已发送至 cdlxz2017@qq.com")
    else:
        print(f"[后处理] ❌ 邮件发送失败: {emailer.stderr}")

    conn.close()
    print(f"[后处理] ✅ 后处理完成 (record {rid})")

if __name__ == "__main__":
    main()
