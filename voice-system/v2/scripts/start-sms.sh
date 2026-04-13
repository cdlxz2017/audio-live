#!/bin/bash
# 启动短信监听进程
cd /home/ai/.openclaw/workspace/voice-system/v2
export PYTHONPATH="/home/ai/.openclaw/workspace/voice-system/v2:$PYTHONPATH"
exec python3 src/sms_handler.py
