# 副脑数据召回监控系统 — 方案文档
> 生成时间：2026-04-21 04:20
> 状态：方案已输出，待主人确认

---

## 一、现状分析

**副脑数据召回链路（完全不涉及主脑）：**

```
用户消息 → problem-thread-plugin (before_prompt_build)
              ├─ loadActiveThreads()     → GET /threads?status=active
              ├─ matchKeywordThreads()   → GET /threads?status=active&q=关键词
              ├─ appendErrorToThread()   → GET + PATCH /threads
              └─ POST /sessions/:id/summary
                         ↓
              Problem Thread API (54321)
                         ↓
              PostgreSQL (54320) — 问题线程 + 向量搜索
                         ↓
              Ollama bge-m3:latest — embedding 计算
```

**召回类型：**
| 召回类型 | 入口 | 数据来源 |
|---------|------|---------|
| active threads 注入 | 首次 prompt_build | PostgreSQL |
| 关键词语义搜索 | 用户消息分析 | PostgreSQL + pgvector |
| 错误信号追加 | 错误检测 | PostgreSQL |
| Session 摘要推送 | command:new/reset | PostgreSQL |

---

## 二、方案对比

| 方案 | 侵入性 | 数据隔离 | 实现难度 | 状态 |
|------|--------|---------|---------|------|
| **A. API 中间件 + SQLite 日志** | 极低 | SQLite 600权限 | 低 | ✅ 推荐 |
| B. 副脑 PostgreSQL 新增审计表 | 中 | 副脑DB | 中 | ⚠️ |
| **C. Docker 日志收集（完全零修改）** | 无 | 独立日志文件 | 高 | 备选 |

---

## 三、方案 A 概要（推荐）

**核心原则：对副脑零修改 / 监控数据完全隔离 / 其他程序无法访问**

1. 副脑 API 中间件（`src/api/index.js` 添加约 20 行观察者代码）
2. 独立 SQLite 审计数据库（600 权限，仅 audit 用户可读）
3. 独立审计进程（每 30 秒采集）
4. 与主脑 `recall-live-monitor.js` 完全隔离

**需授权：副脑代码约 20 行修改**

---

## 四、方案 C（完全零修改）

详见同目录 `PT-RECALL-MONITOR-PLAN-C.md`

---

## 五、待确认

- [ ] 方案 A：授权副脑代码修改 20 行
- [ ] 方案 C：接受 Docker 日志收集实现成本
- [ ] 确认后开始实施
