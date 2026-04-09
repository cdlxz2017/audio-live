#!/usr/bin/env python3
"""摄像头录制核心模块"""
import subprocess
import time
import json
import os
import sys
import signal
from datetime import datetime

def load_config():
    # config.json 在 skill 根目录，不在 scripts 子目录
    skill_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(skill_dir, "config.json")
    with open(path) as f:
        return json.load(f)

class Recorder:
    def __init__(self):
        self.config = load_config()
        self.recording = False
        self.process = None
        self.start_time = None
        self.output_path = None
        self.motion_detected = True  # 简化的运动检测
        
    def check_disk_space(self):
        """检查磁盘空间"""
        stat = os.statvfs(self.config["video_dir"])
        free_gb = stat.f_bavail * stat.f_frsize / (1024**3)
        if free_gb < self.config.get("disk_space_min_gb", 1):
            return False, f"磁盘空间不足: {free_gb:.1f}GB < {self.config['disk_space_min_gb']}GB"
        return True, f"磁盘空间: {free_gb:.1f}GB"
    
    def start_preview(self, device):
        """打开摄像头预览流（不录制）"""
        cmd = [
            "ffplay", "-i", device,
            "-vf", "format=yuv420p",
            "-window_title", "Camera Preview",
            "-left", "100", "-top", "100"
        ]
        try:
            self.process = subprocess.Popen(cmd)
            return True, f"预览启动: {device}"
        except Exception as e:
            return False, f"预览启动失败: {e}"
    
    def start_recording(self, device, audio_card=None):
        """开始录制"""
        # 检查磁盘空间
        ok, msg = self.check_disk_space()
        if not ok:
            return False, msg
        
        # 生成文件名
        now = datetime.now()
        date_str = now.strftime("%Y-%m-%d_%H%M%S")
        filename = f"{date_str}.mp4"
        os.makedirs(self.config["video_dir"], exist_ok=True)
        self.output_path = os.path.join(self.config["video_dir"], filename)
        
        # ffmpeg H.264 直录命令（摄像头硬件编码，高质量+实时）
        audio_input = f"hw:{audio_card}" if audio_card else self.config.get("audio_device", "default")
        cmd = [
            "ffmpeg",
            "-f", "v4l2",
            "-input_format", "h264",  # 使用摄像头 H.264 硬件编码流
            "-i", device,
            "-f", "alsa",
            "-ac", "1",               # 单声道
            "-i", audio_input,
            "-c:v", "copy",           # 直接复制 H.264 流，不重新编码
            "-c:a", "aac",
            "-b:a", self.config.get("ffmpeg_audio_bitrate", "128k"),
            "-ar", str(self.config.get("ffmpeg_sample_rate", 48000)),
            "-y",
            self.output_path
        ]
        
        try:
            self.process = subprocess.Popen(
                cmd,
                start_new_session=True  # 脱离父进程，确保 ffmpeg 持续运行
            )
            self.recording = True
            self.start_time = time.time()
            return True, f"录制开始: {self.output_path}"
        except Exception as e:
            return False, f"录制启动失败: {e}"
    
    def stop_recording(self):
        """停止录制"""
        if not self.recording or not self.process:
            return False, "当前不在录制中", None
        
        # ffmpeg 是 session leader，用 SIGTERM 终止整个会话组
        try:
            import os, signal
            pgid = os.getpgid(self.process.pid)
            os.killpg(pgid, signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass
        
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                import os, signal
                pgid = os.getpgid(self.process.pid)
                os.killpg(pgid, signal.SIGKILL)
            except (ProcessLookupError, OSError):
                pass
            self.process.wait(timeout=5)
        
        self.recording = False
        duration = time.time() - self.start_time if self.start_time else 0
        self.process = None
        
        if self.output_path and os.path.exists(self.output_path):
            size = os.path.getsize(self.output_path)
            return True, f"录制停止: {self.output_path}", {
                "path": self.output_path,
                "duration_sec": int(duration),
                "size_bytes": size
            }
        return False, "录制文件不存在", None
    
    def is_recording(self):
        """检查是否在录制中"""
        if not self.recording:
            return False
        if self.process and self.process.poll() is not None:
            # 进程已退出但标志未更新
            self.recording = False
            return False
        return True
    
    def get_status(self):
        """获取录制状态"""
        if self.is_recording():
            elapsed = int(time.time() - self.start_time) if self.start_time else 0
            return {
                "recording": True,
                "elapsed_sec": elapsed,
                "output": self.output_path
            }
        return {"recording": False}

def main():
    if len(sys.argv) < 2:
        print("Usage: recorder.py <start|stop|status|preview> [device] [--audio-card=N]")
        sys.exit(1)
    
    cmd = sys.argv[1]
    device = None
    audio_card = None
    for arg in sys.argv[2:]:
        if arg.startswith("--audio-card="):
            audio_card = arg.split("=", 1)[1]
        else:
            device = arg
    
    r = Recorder()
    
    if cmd == "start":
        if not device:
            from port_detector import detect_camera
            device, audio_card = detect_camera()
            if not device:
                print("ERROR: No camera detected")
                sys.exit(1)
        ok, msg = r.start_recording(device, audio_card)
        print(f"{'OK' if ok else 'ERROR'}:{msg}")
    
    elif cmd == "stop":
        ok, msg, info = r.stop_recording()
        print(f"{'OK' if ok else 'ERROR'}:{msg}")
        if info:
            print(f"duration={info['duration_sec']}s size={info['size_bytes']}b")
            print(f"path:{info['path']}")
    
    elif cmd == "status":
        status = r.get_status()
        print(json.dumps(status))
    
    elif cmd == "preview":
        if not device:
            from port_detector import detect_camera
            device, _ = detect_camera()
            if not device:
                print("ERROR: No camera detected")
                sys.exit(1)
        ok, msg = r.start_preview(device)
        print(f"{'OK' if ok else 'ERROR'}:{msg}")
        if ok:
            try:
                while r.process.poll() is None:
                    time.sleep(1)
            except KeyboardInterrupt:
                r.process.terminate()
    
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)

if __name__ == "__main__":
    main()
