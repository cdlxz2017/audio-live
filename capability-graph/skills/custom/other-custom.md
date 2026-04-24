# 其他自制 Skill（无 SKILL.md）

## benchmark-skill-ui-ux-pro-max
- **路径**：`~/ai/projects/benchmark-skill-ui-ux-pro-max/`
- **状态**：✅ 已安装（2026-04-21）
- **说明**：批量生成高质量落地页的基准测试项目，使用 ui-ux-pro-max Skill
- **Skill**：`.claude/skills/ui-ux-pro-max/`（57种UI风格/95种配色/56种字体组合）
- **主要脚本**：
  - `generate.ts` — 原始版（GLM 4.7 + Claude Code SDK）
  - `generate-openai.ts` — **当前使用版**（Qwen3.6-Plus + OpenAI SDK）
- **模型**：阿里云百炼 Qwen3.6-Plus（OpenAI 兼容端点）
- **API Key**：`DASHSCOPE_API_KEY`（统一凭证管理）
- **运行**：
  ```bash
  cd ~/ai/projects/benchmark-skill-ui-ux-pro-max
  export DASHSCOPE_API_KEY="sk-50c8c0524a8244ffbdcb9131545dfa56"
  npx tsx generate-openai.ts
  ```
- **验证**：ai-chatbot 页面生成成功（27350字符，436行）
- **备注**：Claude Code SDK 与百炼端点不兼容，已改用 OpenAI SDK

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
