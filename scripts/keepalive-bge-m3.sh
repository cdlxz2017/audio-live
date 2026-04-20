#!/bin/bash
# 保活脚本：定期调用 bge-m3:latest 生成 embedding，防止 Ollama 将其卸载出内存
# 建议频率：每 3 分钟一次（足够防止卸载，又不会浪费资源）

curl -s -X POST http://localhost:11434/api/embeddings \
  -d '{"model":"bge-m3:latest","prompt":"heartbeat"}' > /dev/null 2>&1
