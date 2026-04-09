#!/usr/bin/env python3
"""
音频流后处理脚本 - 接收 webm 路径，完成：
  转换格式 → 转写 → 摘要 → 逆地理编码 → 写入 video_records 表 → 发送邮件
"""
import subprocess
import sys
import os
import psycopg2
import reverse_geocoder as rg
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def reverse_geocode(lat, lng):
    """使用离线 reverse_geocoder 逆地理编码（省/市/区/镇）"""
    if lat is None or lng is None:
        return None
    try:
        result = rg.search([(float(lat), float(lng))])
        if result:
            r = result[0]
            parts = []
            for key in ["admin1", "admin2", "name"]:
                v = r.get(key, "")
                if v:
                    parts.append(v)
            location = " ".join(parts)
            print(f"[地理] {lat},{lng} → {location}")
            return location
    except Exception as e:
        print(f"[地理] 逆地理编码异常: {e}")
    return None

def main():
    if len(sys.argv) < 2:
        print("Usage: audio_post_process.py <webm_path> [session_id] [latitude] [longitude]")
        sys.exit(1)

    webm_path = sys.argv[1]
    session_id = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(webm_path).replace('.webm', '')
    lat = float(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else None
    lng = float(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else None
    audio_dir = os.path.dirname(webm_path)
    filename = f"recording_{session_id}"
    mp3_path = os.path.join(audio_dir, filename + ".mp3")
    txt_path = os.path.join(audio_dir, filename + ".txt")
    summary_path = os.path.join(audio_dir, filename + "_摘要.txt")

    print(f"[后处理] 开始处理: {webm_path}")

    # 0. 逆地理编码（提前做，邮件和数据库都要用）
    location_name = None
    if lat and lng:
        print(f"[地理] 正在逆地理编码 {lat}, {lng} ...")
        location_name = reverse_geocode(lat, lng)

    # 1. 转换 webm → mp3
    print("[后处理] 转换格式...")
    convert = subprocess.run(
        ["ffmpeg", "-y", "-i", webm_path,
         "-vn", "-acodec", "libmp3lame", "-ab", "128k",
         "-ar", "16000", "-ac", "1", mp3_path],
        capture_output=True, text=True, timeout=300
    )
    if convert.returncode != 0:
        print(f"[后处理] ❌ 格式转换失败: {convert.stderr}")
        sys.exit(1)
    mp3_size = os.path.getsize(mp3_path) // 1024 // 1024
    print(f"[后处理] 转换完成: {mp3_path} ({mp3_size}MB)")

    # 2. 转写
    print("[后处理] 开始转写...")
    tsc = subprocess.run(
        ["python3", f"{SCRIPT_DIR}/transcriber.py", mp3_path],
        capture_output=True, text=True, timeout=600
    )
    if tsc.returncode != 0 or not tsc.stdout.strip():
        print(f"[后处理] ❌ 转写失败: {tsc.stderr}")
        sys.exit(1)

    transcript = tsc.stdout.strip()
    if transcript.startswith("OK:"):
        transcript = transcript[3:].strip()
    print(f"[后处理] 转写完成: {len(transcript)} 字符")

    # 3. 写入转写文本文件
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(transcript)
    print(f"[后处理] 转写文件: {txt_path}")

    # 4. 生成摘要
    print("[后处理] 生成摘要...")
    sum_proc = subprocess.run(
        ["python3", f"{SCRIPT_DIR}/summarizer.py", txt_path, summary_path],
        capture_output=True, text=True
    )
    summary = ""
    if sum_proc.returncode == 0 and os.path.exists(summary_path):
        with open(summary_path, encoding="utf-8") as f:
            summary = f.read().strip()
        print(f"[后处理] 摘要完成")
    else:
        print(f"[后处理] ⚠️ 摘要生成失败: {sum_proc.stderr}")

    # 5. 获取音频时长
    duration = 0
    ffprobe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", mp3_path],
        capture_output=True, text=True
    )
    try:
        duration = int(float(ffprobe.stdout.strip()))
    except:
        pass
    print(f"[后处理] 时长: {duration}s")

    # 6. 写入 video_records 表
    record_id = None
    try:
        conn = psycopg2.connect(
            host="localhost", port=5432,
            user="openclaw_ai", password="zyxrcy910128",
            database="openclaw_memory"
        )
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO video_records (filename, filepath, duration_sec, file_size_bytes, transcript, transcript_status, latitude, longitude, location_name)
            VALUES (%s, %s, %s, %s, %s, 'done', %s, %s, %s) RETURNING id
        """, (filename, mp3_path, duration, os.path.getsize(mp3_path), transcript, lat, lng, location_name))
        record_id = cur.fetchone()[0]
        conn.commit()
        print(f"[后处理] 数据库写入成功: id={record_id}")
        conn.close()
    except Exception as e:
        print(f"[后处理] ⚠️ 数据库写入失败: {e}")

    # 7. 发送邮件
    print("[后处理] 发送邮件...")
    email_script = "/home/ai/.openclaw/workspace/custom-skills/camera-recorder/scripts/emailer.py"
    email_args = ["python3", email_script, "send",
         "cdlxz2017@qq.com", filename,
         txt_path, summary_path, str(duration)]
    if lat and lng:
        email_args.extend([str(lat), str(lng), location_name or ""])
    email_result = subprocess.run(email_args, capture_output=True, text=True, timeout=30)

    email_ok = (email_result.returncode == 0)
    if email_ok:
        print(f"[后处理] ✅ 邮件已发送至 cdlxz2017@qq.com")
    else:
        print(f"[后处理] ❌ 邮件发送失败: {email_result.stderr}")

    # 8. 更新 email 状态
    if record_id and email_ok:
        try:
            conn = psycopg2.connect(
                host="localhost", port=5432,
                user="openclaw_ai", password="zyxrcy910128",
                database="openclaw_memory"
            )
            cur = conn.cursor()
            cur.execute(
                "UPDATE video_records SET email_sent=true, email_sent_at=NOW() WHERE id=%s",
                (record_id,)
            )
            conn.commit()
            conn.close()
        except:
            pass

    print(f"[后处理] ✅ 处理完成: recording_{session_id}")

if __name__ == "__main__":
    main()
