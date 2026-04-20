# 其他自制 Skill（无 SKILL.md）

## audio-stream
- **路径**：`custom-skills/audio-stream/`
- **状态**：🔧 开发中
- **说明**：音频流服务，含证书文件（cert.pem/key.pem）
- **配置**：ecosystem.config.json

## graphify-manager
- **路径**：`custom-skills/graphify-manager/`
- **状态**：🔧 开发中
- **说明**：Graphify 代码图谱管理工具
- **主要脚本**：
  - backfill-alignments.js — 对齐回填
  - bridge-layer.js — 对齐逻辑
  - backfill-embeddings.js — 嵌入回填
- **PM2**: graphify-opus-manager（PID 8）

## task-router
- **路径**：`custom-skills/task-router/`
- **状态**：🔧 开发中
- **说明**：任务路由工具
- **脚本**：scripts/
