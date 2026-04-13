#!/bin/bash
# 启动监听进程
cd /home/ai/.openclaw/workspace/voice-system/v2
export PYTHONPATH="/home/ai/.openclaw/workspace/voice-system/v2:$PYTHONPATH"
exec python3 src/voice_listener.py
