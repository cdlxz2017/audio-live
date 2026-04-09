#!/usr/bin/env python3
"""摄像头+麦克风端口检测，支持热插拔"""
import os
import glob
import sys
import subprocess

def list_video_devices():
    """列出所有可用的视频设备"""
    devices = []
    for path in sorted(glob.glob("/dev/video*")):
        try:
            with open(path, 'rb') as f:
                pass
            devices.append(path)
        except (PermissionError, IOError):
            devices.append(path)
    return devices

def get_device_name(dev_path):
    """获取设备名称"""
    try:
        name_file = f"/sys/class/video4linux/{os.path.basename(dev_path)}/name"
        with open(name_file) as f:
            return f.read().strip()
    except:
        return "Unknown device"

def get_audio_cards():
    """获取所有音频设备"""
    try:
        result = subprocess.run(
            ["arecord", "-l"],
            capture_output=True, text=True, timeout=5
        )
        cards = []
        for line in result.stdout.split("\n"):
            if "card " in line and "[" in line:
                # 解析: card 2: O2 [OBSBOT Tiny 2], device 0: USB Audio [USB Audio]
                parts = line.split(":")
                if len(parts) >= 2:
                    card_part = parts[0].strip()  # "card 2"
                    name_part = parts[1].strip()  # "O2 [OBSBOT Tiny 2], device 0: USB Audio [USB Audio]"
                    card_num = card_part.replace("card ", "").strip()
                    # 提取设备名
                    bracket_content = name_part.split("[")[1].split("]")[0] if "[" in name_part else name_part
                    cards.append({"card": card_num, "name": bracket_content})
        return cards
    except:
        return []

def detect_obsbot():
    """检测 OBSBOT 摄像头，返回 (video_device, audio_card)"""
    video_devices = list_video_devices()
    obsbot_video = None
    obsbot_audio = None
    
    # 找 OBSBOT 视频设备
    for dev in video_devices:
        name = get_device_name(dev)
        if "OBSBOT" in name or "obsbot" in name:
            obsbot_video = dev
            break
    
    # 找 OBSBOT 音频设备
    audio_cards = get_audio_cards()
    for card in audio_cards:
        if "OBSBOT" in card["name"] or "O2" in card["name"] or "obsbot" in card["name"].lower():
            obsbot_audio = card["card"]
            break
    
    return obsbot_video, obsbot_audio

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--list":
        print("=== 视频设备 ===")
        for dev in list_video_devices():
            print(f"{dev}: {get_device_name(dev)}")
        print("\n=== 音频设备 ===")
        for card in get_audio_cards():
            print(f"card {card['card']}: {card['name']}")
    else:
        video, audio = detect_obsbot()
        if video:
            print(f"OK:{video}")
            if audio:
                print(f"AUDIO:hw:{audio}")
        else:
            print("ERROR:未检测到 OBSBOT 摄像头")
            sys.exit(1)

if __name__ == "__main__":
    main()
