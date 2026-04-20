#!/bin/bash
# 将 memory/learned/ 中的研究结果导入 memory_summaries
# recall 系统会自动召回这些内容
cd /home/ai/.openclaw/workspace/memory-system
node scripts/import-learned-to-summaries.js >> logs/import-learned.log 2>&1
