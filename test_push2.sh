#!/bin/bash
cd /home/ai/.openclaw/workspace
python3 voice-system/src/push_call_summary.py \
  "18180805797" "15" \
  "好，主人暂时无法接听，请留言，听到滴声后可开始说话。ok，我们现在开始测试整个流程，希望整个流程都是正常的。ok." \
  "/home/ai/.openclaw/workspace/voice-system/recordings/inbound/20260413_093633_18180805797.wav"
