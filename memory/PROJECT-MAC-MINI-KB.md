# Mac Mini 智能知识库项目

> 状态：方案已确认，待实施
> 创建：2026-04-21
> 负责人：玄枢（远程 SSH 管理）

---

## 硬件约束
- Mac Mini M2 + 8GB RAM（硬约束）
- 不能跑本地大模型（OOM）
- 不能跑 Neo4j（内存不够）

## 核心架构

```
Mac Mini M2 (8GB) ← 瘦终端定位
├── OpenClaw（Homebrew，我来远程管理）
├── Ollama（BGE-m3 Embedding，本地免费）
├── Chroma（轻量向量库，~500MB）
├── PostgreSQL（文档元数据 + 多用户）
└── LLM 推理 → 100% 云端
      ├── DeepSeek Chat → 日常文案
      └── Claude Opus → 法律/中医（幻觉最低）

访问：Tailscale（已有体系复用）
```

## 能做什么
- 法律文档问答 + 文书生成
- 中医知识问答 + 药方生成
- 技术文档整理
- 多用户访问

## 安全
- Tailscale 加密通道
- 不暴露公网 IP

## 与现有系统分工
| 内容 | 位置 |
|------|------|
| 私人文档/法律/中医 | Mac Mini 知识库（新建）|
| 技术文档/代码图谱 | 现有服务器 tech-knowledge |
| Neo4j 图谱（170万节点）| 现有服务器 |

## 待确认问题（主人回答）
1. 文档来源：已有文档迁移 or 全新开始？
2. 用户数量：影响多用户认证方案
3. 数据备份：Mac Mini 硬盘多大？重要文档备份需求？

## 部署计划
- Phase 1：基础环境（Homebrew / Tailscale / OpenClaw）
- Phase 2：数据存储层（PostgreSQL / Chroma）
- Phase 3：AI 基础设施（Ollama Embedding + API Keys）
- Phase 4：知识库核心（RAG 工作流）
- Phase 5：OpenClaw 集成
- Phase 6：安全加固 + 验收

## 状态
- 方案：✅ 已完成
- 实施：⏳ 待定（等主人时间）
