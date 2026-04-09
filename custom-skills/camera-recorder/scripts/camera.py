#!/usr/bin/env python3
"""
摄像头录制系统 - 命令行入口
统一管理：端口检测 → 打开/录制/停止 → 运动检测 → 转写 → 数据库 → 邮件
"""
import subprocess
import os
import sys
import json
import threading
import signal
import time
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

def load_config():
    skill_dir = os.path.dirname(SCRIPT_DIR)
    path = os.path.join(skill_dir, "config.json")
    with open(path) as f:
        return json.load(f)

# 全局录制状态
_recording_state = None
_ffmpeg_proc = None
_should_stop = False

# ============================================================
# 录制核心
# ============================================================

def cmd_start_daemon(device, audio_card):
    """启动 ffmpeg H.265 录制进程"""
    audio_dev = f"hw:{audio_card}" if audio_card else "default"
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d_%H%M%S")
    video_dir = load_config().get("video_dir", "/home/ai/videos")
    os.makedirs(video_dir, exist_ok=True)

    filepath = os.path.join(video_dir, f"{date_str}.mp4")
    crf = load_config().get("h265_crf", 23)
    maxrate = load_config().get("video_maxrate", "2M")
    bufsize = load_config().get("video_bufsize", "4M")
    audio_bitrate = load_config().get("ffmpeg_audio_bitrate", "128k")
    sample_rate = load_config().get("ffmpeg_sample_rate", 48000)

    cmd = [
        "ffmpeg",
        "-f", "v4l2", "-input_format", "h264", "-i", device,
        "-f", "alsa", "-ac", "1", "-i", audio_dev,
        "-c:v", "libx265", "-crf", str(crf), "-preset", "fast",
        "-maxrate", maxrate, "-bufsize", bufsize,
        "-c:a", "aac", "-b:a", audio_bitrate, "-ar", str(sample_rate),
        "-y", filepath
    ]
    proc = subprocess.Popen(cmd, start_new_session=True)
    return filepath, proc.pid



# ============================================================
# 运动检测（文件增长率法）
# V4L2 设备互斥锁导致无法同时读 H.264 流，
# 改用监控录制文件的实际大小增长率来判断画面是否静止
# ============================================================

def motion_detection_loop(filepath, threshold_sec=180):
    """
    运动检测：每 10 秒检查文件大小增长率
    连续 threshold_sec 秒增长率低于阈值 → 判定静止 → 自动停止
    """
    global _recording_state, _should_stop

    check_interval = 10
    min_growth_bps = 50000   # 低于 50KB/s 视为静止（可调）
    prev_size = 0
    prev_time = None
    still_start = None

    while _recording_state and _recording_state.get("recording") and not _should_stop:
        time.sleep(check_interval)

        if not os.path.exists(filepath):
            continue

        current_size = os.path.getsize(filepath)
        current_time = time.time()

        if prev_time is not None:
            elapsed = current_time - prev_time
            bytes_grown = current_size - prev_size
            growth_bps = bytes_grown / elapsed if elapsed > 0 else 0

            is_still = growth_bps < min_growth_bps

            if is_still:
                if still_start is None:
                    still_start = current_time
                    print(f"[MotionDetector] ⚠️ 画面可能静止... ({int(current_time-still_start)}s / {threshold_sec}s)")
                elapsed_still = current_time - still_start
                remaining = threshold_sec - elapsed_still
                if remaining > 0 and remaining % 30 < check_interval:
                    print(f"[MotionDetector] 静止中 {int(elapsed_still)}s，剩余 {int(remaining)}s 触发停止")
                if elapsed_still >= threshold_sec:
                    print(f"[MotionDetector] 🚨 静止 {threshold_sec}s（增长率 {growth_bps/1024:.1f}KB/s），触发自动停止！")
                    _should_stop = True
                    break
            else:
                if still_start is not None:
                    print(f"[MotionDetector] ✅ 检测到运动（增长率 {growth_bps/1024:.1f}KB/s），重置计时器")
                still_start = None

        prev_size = current_size
        prev_time = current_time

    if _should_stop:
        print("[MotionDetector] → 发送停止信号")

# ============================================================
# 端口检测
# ============================================================

def detect_camera():
    """检测摄像头端口"""
    result = subprocess.run(
        ["python3", f"{SCRIPT_DIR}/port_detector.py"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        return None, None
    video_dev, audio_card = None, None
    for line in result.stdout.strip().split("\n"):
        if line.startswith("OK:"):
            video_dev = line.split(":", 1)[1].strip()
        elif line.startswith("AUDIO:hw:"):
            audio_card = line.split("hw:", 1)[1].strip()
    return video_dev, audio_card

# ============================================================
# 状态文件
# ============================================================

def state_file():
    return os.path.join(SCRIPT_DIR, ".recording_state.json")

def save_state(state):
    with open(state_file(), "w") as f:
        json.dump(state, f)

def load_state():
    if os.path.exists(state_file()):
        with open(state_file()) as f:
            return json.load(f)
    return None

def clear_state():
    if os.path.exists(state_file()):
        os.remove(state_file())

# ============================================================
# 命令实现
# ============================================================

def do_open():
    """打开预览"""
    device, audio_card = detect_camera()
    if not device:
        return "ERROR: 未检测到摄像头"
    preview_cmd = [
        "ffplay",
        "-f", "v4l2", "-input_format", "mjpeg",
        "-video_size", "1920x1080",
        "-i", device,
        "-vf", "format=yuv420p",
        "-left", "100", "-top", "100",
        "-window_title", f"OBSBOT ({device})"
    ]
    try:
        subprocess.Popen(preview_cmd)
        return f"OK: 摄像头已打开 (device={device})"
    except Exception as e:
        return f"ERROR: {e}"

def do_start():
    """开始录制"""
    global _recording_state, _ffmpeg_proc, _should_stop

    state = load_state()
    if state and state.get("recording"):
        return "ERROR: 已经在录制中"

    device, audio_card = detect_camera()
    if not device:
        return "ERROR: 未检测到摄像头"

    _should_stop = False
    filepath, pid = cmd_start_daemon(device, audio_card)

    _recording_state = {
        "recording": True,
        "device": device,
        "audio_card": audio_card,
        "filepath": filepath,
        "pid": pid,
        "started_at": datetime.now().isoformat()
    }
    save_state(_recording_state)

    # 启动运动检测线程（每 10 秒检测一次）
    cfg = load_config()
    threshold_sec = cfg.get("motion_still_threshold_sec", 180)
    threading.Thread(target=motion_detection_loop, args=(filepath, threshold_sec), daemon=True).start()

    return f"✅ 已经开始录制 (device={device}, audio=hw:{audio_card}) → PID:{pid} | 运动检测：{threshold_sec}s 静止触发"

def do_stop():
    """停止录制"""
    global _recording_state, _ffmpeg_proc, _should_stop

    state = load_state()
    if not state or not state.get("recording"):
        return "ERROR: 当前不在录制中"

    pid = state.get("pid")
    path = state.get("filepath")

    # 停止 ffmpeg
    if pid:
        try:
            import os as _os
            pgid = _os.getpgid(int(pid))
            _os.killpg(pgid, signal.SIGTERM)
        except (ProcessLookupError, OSError, ValueError):
            pass

    time.sleep(1)
    _recording_state = None
    clear_state()

    # 获取文件信息
    if os.path.exists(path):
        size = os.path.getsize(path)
        duration = 0
        try:
            r = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", path],
                capture_output=True, text=True, timeout=10
            )
            duration = int(float(r.stdout.strip() or "0"))
        except:
            pass

        filename = os.path.basename(path)

        # 写入数据库
        subprocess.run(
            ["python3", f"{SCRIPT_DIR}/db.py", "insert", filename, path, str(duration), str(size)],
            capture_output=True
        )

        # 异步转写 + 邮件（独立子进程，nohup 脱离主 session）
        subprocess.Popen(
            f"nohup python3 {SCRIPT_DIR}/post_record.py {path} {duration} {filename} >/tmp/post_record.log 2>&1 &",
            shell=True, start_new_session=True
        )
        return f"✅ 录制结束，文件: {filename} ({duration}s, {size//1024//1024}MB)，转写处理中"

    return "✅ 录制结束（无文件）"

def do_status():
    """查看状态"""
    state = load_state()
    if state and state.get("recording"):
        started = datetime.fromisoformat(state["started_at"])
        elapsed = int((datetime.now() - started).total_seconds())
        mins, secs = divmod(elapsed, 60)
        return (f"🎙️ 录制中\n"
                f"设备: {state.get('device')}\n"
                f"文件: {os.path.basename(state.get('filepath', ''))}\n"
                f"已录制: {mins}分{secs}秒")
    return "○ 未在录制"

# ============================================================
# 主入口
# ============================================================

def main():
    if len(sys.argv) < 2:
        print("摄像头录制系统")
        print("用法: camera.py <open|start|stop|status>")
        sys.exit(1)

    action = sys.argv[1]
    result = ""

    if action == "open":
        result = do_open()
    elif action == "start":
        result = do_start()
    elif action == "stop":
        result = do_stop()
    elif action == "status":
        result = do_status()
    else:
        result = f"ERROR: 未知命令 '{action}'"

    print(result)

if __name__ == "__main__":
    main()
