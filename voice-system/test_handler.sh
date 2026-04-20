#!/bin/bash
cp /tmp/bidirectional_test.wav /home/ai/.openclaw/workspace/voice-system/recordings/inbound/test_sample.wav
python3 /home/ai/.openclaw/workspace/voice-system/src/voice_call_handler.py \
  /home/ai/.openclaw/workspace/voice-system/recordings/inbound/test_sample.wav \
  "13800001234" 49
