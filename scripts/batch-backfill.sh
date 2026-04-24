#!/bin/bash
# Batch backfill recent sessions
cd /home/ai/.openclaw/workspace

SESSIONS=(
  "c81e37e4-7e34-4e51-877f-ef31f3e14ecd"
  "91934771-94b4-4134-b4f0-d8fa6df48175"
  "9117dd31-a3a7-419b-90cf-792bc6078243"
  "b78d26d3-5a3a-4eb7-82e1-f12d187d86e3"
  "de97e5a7-9e97-4605-9aea-2d6cc9057186"
  "1837f30c-0779-4b34-9b9b-4098ee49bf19"
  "7cd7bf09-79d7-455b-8d04-cd148c2a5b20"
  "4da4ca0b-74ad-496d-9cd6-acd5f4674c8f"
  "d8c01f8d-e6dd-4429-a239-e7015047b914"
  "eabf2892-3d9f-437a-aad6-614526424b8b"
  "38984aa2-cf48-4407-97e0-8f601a4d7311"
  "59fa54ae-3b4f-4b92-9908-e22881c2ba7f"
  "6d540048-6bf0-4382-9e56-3c23e0148b01"
  "78573e0a-42d1-40a2-8495-a6648652a8fb"
  "aae032af-c963-47f0-9f12-4bdaa592d69a"
  "7fb5dee3-14d9-4af7-a6bd-1238f319ba6a"
  "6e653df5-c9d1-4886-84c1-f25455e8c25c"
  "5ae493fc-25b7-4dd7-a2bd-15595cd5c2ef"
  "b4ad2085-b5cb-4691-a5d9-c0dc6278d8b7"
)

for sid in "${SESSIONS[@]}"; do
  f="/home/ai/.openclaw/agents/main/sessions/${sid}.jsonl"
  if [ -f "$f" ]; then
    echo "=== Processing $sid ==="
    node /home/ai/.openclaw/workspace/scripts/quick-backfill.js "$f" 2>&1 | grep -v "^\[DB\]\|\[Redis\]"
  else
    echo "SKIP: $f not found"
  fi
done
