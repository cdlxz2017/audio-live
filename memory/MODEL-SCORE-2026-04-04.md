# 大模型能力检测报告

> 检测时间：2026-04-04 05:30
> 检测方式：直接 curl 测试各 API endpoint
> Gateway 状态：✅ 正常运行 (PID 170064, 05:31启动)

---

## 一、可用模型总览

| 模型 | Provider | 状态 | 响应速度 | 上下文 | 评分 | 擅长场景 |
|------|----------|------|----------|--------|------|----------|
| **claude-opus-4-6** | 4sapi | ✅ | ~1.5s | 200K | ⭐⭐⭐⭐⭐ 9/10 | 代码/推理/分析 |
| **claude-sonnet-4-6** | 4sapi | ✅ | ~1.5s | 200K | ⭐⭐⭐⭐ 8/10 | 日常对话/写作 |
| **deepseek-reasoner** | deepseek | ✅ | ~1.5s | 1600K | ⭐⭐⭐⭐ 8/10 | 深度推理/思考 |
| **deepseek-chat** | deepseek | ✅ | ~1s | 1600K | ⭐⭐⭐⭐ 8/10 | 快速问答/翻译 |
| **gpt-4.1-mini** | opendoor | ✅ | ~1.4s | 2000K | ⭐⭐⭐ 7/10 | 备用/快速任务 |
| **llama-4-maverick** | nvidia | ✅ | ~0.8s | 1048K | ⭐⭐⭐ 7/10 | 英文对话/轻量任务 |
| **nemotron-ultra** | nvidia | ✅ | ~0.7s | 131K | ⭐⭐⭐ 7/10 | 英文任务 |
| **kimi-k2** | nvidia | ✅ | ~1.7s | 131K | ⭐⭐⭐ 7/10 | 快速响应 |
| **qwen3:30b-a3b** | ollama (本地) | ✅ | ~26s | 131K | ⭐⭐⭐ 6/10 | 本地推理/隐私任务 |
| **deepseek-r1:8b** | ollama (本地) | ✅ | ~29s | 131K | ⭐⭐⭐ 6/10 | 本地深度思考 |
| **qwen3.5-vision** | ollama (本地) | ✅ | ~6s | 262K | ⭐⭐⭐ 7/10 | 图文理解 |
| **gemini-3-flash** | 4sapi-gemini | ✅ | ~2s | 1000K | ⭐⭐⭐ 7/10 | 快速生成/长上下文 |
| **MiniMax-M2.7** | minimax | ✅ | ~1s | 100K | ⭐⭐⭐ 7/10 | 高速对话/长文本 |
| **MiniMax-M2.5** | minimax-cn | ✅ | ~1s | 100K | ⭐⭐⭐ 7/10 | 高速对话/翻译 |
| **bge-m3** | ollama (向量) | ⚠️ | - | - | - | 向量嵌入(需单独验证) |

---

## 二、分 Provider 详情

### 1. 4sapi (✅ 主用)

**Endpoint:** `https://4sapi.com/v1`

| 模型 | 状态 | 速度 | 备注 |
|------|------|------|------|
| claude-opus-4-6 | ✅ | ~1.5s | **主推**，Claude 4 Opus，支持200K上下文 |
| claude-sonnet-4-6 | ✅ | ~1.5s | 备用，轻量级任务 |

**优势：** 官方 Claude 模型，能力最强，200K 上下文
**注意：** cost 显示为 0（可能计费未配置或免费额度）

---

### 2. deepseek (✅ 备用)

**Endpoint:** `https://api.deepseek.com/v1`

| 模型 | 状态 | 速度 | 备注 |
|------|------|------|------|
| deepseek-reasoner | ✅ | ~1.5s | 深度推理模型，含 reasoning_content |
| deepseek-chat | ✅ | ~1s | 快速对话，速度最快 |

**优势：** 1600K 超大上下文，价格便宜，速度快
**擅长：** 长文本分析、代码生成、翻译

---

### 3. nvidia (✅ 快速)

**Endpoint:** `https://integrate.api.nvidia.com/v1`

| 模型 | 状态 | 速度 | 备注 |
|------|------|------|------|
| meta/llama-4-maverick | ✅ | ~0.8s | **最快**，Llama 4 |
| nvidia/llama-3.1-nemotron-ultra | ✅ | ~0.7s | 速度优秀 |
| moonshotai/kimi-k2 | ✅ | ~1.7s | Moonshot K2 |

**优势：** NVIDIA NIM 托管，**响应速度最快**（<1s）
**注意：** 部分模型只有英文能力强

---

### 4. opendoor (✅ 备用)

**Endpoint:** `https://ai.opendoor.cn/v1`

| 模型 | 状态 | 速度 | 备注 |
|------|------|------|------|
| gpt-4.1-mini | ✅ | ~1.4s | GPT-4.1 轻量版，2000K 上下文 |

**优势：** GPT-4.1 系列，超大上下文，价格低
**擅长：** 快速问答、长上下文任务

---

### 5. ollama (✅ 本地)

**Endpoint:** `http://localhost:11434`

| 模型 | 状态 | 速度 | 备注 |
|------|------|------|------|
| qwen3:30b-a3b | ✅ | ~26s | Qwen3 30B MoE，能力强但慢 |
| deepseek-r1:8b | ✅ | ~29s | DeepSeek R1 8B，深度思考 |
| qwen3.5-vision | ✅ | ~6s | **最快**，支持图文 |

**优势：** 完全免费、本地运行、隐私安全
**劣势：** 速度慢（6-29秒），依赖机器配置
**注意：** qwen3:30b-a3b 和 deepseek-r1:8b 需要加载大模型，**首次调用慢**

---

### 6. minimax (✅ 可用)

**Endpoint:** `https://api.minimaxi.com/anthropic/v1`

| 模型 | 状态 | 速度 | 上下文 | 备注 |
|------|------|------|--------|------|
| MiniMax-M2.7 | ✅ | ~1s | 100K | 高速对话/长文本 |
| MiniMax-M2.5 | ✅ | ~1s | 100K | 高速翻译 |

**优势：** 速度快（~1s），中文友好，价格便宜
**配置方式：** `auth-profiles.json` (type: api_key)

---

### 7. 4sapi-gemini (✅ 可用)

**Endpoint:** `https://4sapi.com/v1`

| 模型 | 状态 | 速度 | 上下文 | 备注 |
|------|------|------|--------|------|
| gemini-3-flash | ✅ | ~2s | 1000K | 快速生成/长上下文 |

---

## 三、能力矩阵

| 任务类型 | 推荐模型 | 备选 | 备注 |
|----------|----------|------|------|
| **日常对话** | claude-sonnet-4-6 (4sapi) | deepseek-chat | 快速流畅 |
| **代码生成** | claude-opus-4-6 (4sapi) | deepseek-chat | Opus 最强 |
| **深度推理/思考** | deepseek-reasoner | claude-opus-4-6 | reasoner 含思考链 |
| **长文本分析 (100K+)** | deepseek-chat / gpt-4.1-mini | - | 超大上下文 |
| **快速问答 (<2s)** | nvidia/nemotron (~0.7s) | nvidia/llama-4 (~0.8s) | 速度优先 |
| **翻译** | deepseek-chat | claude-opus-4-6 | 速度快质量好 |
| **创意写作** | claude-opus-4-6 | claude-sonnet-4-6 | Opus 最强 |
| **图片理解** | qwen3.5-vision (ollama) | - | 本地多模态 |
| **隐私/本地任务** | qwen3:30b-a3b (ollama) | deepseek-r1:8b (ollama) | 完全本地 |
| **备用/兜底** | gpt-4.1-mini (opendoor) | llama-4-maverick (nvidia) | 量大便宜 |

---

## 四、使用策略

### 4.1 主对话（直接回复）

| 场景 | 推荐模型 | 速度 | 评分 |
|------|----------|------|------|
| 日常问答、闲聊 | `4sapi/claude-sonnet-4-6` | ~1.5s | ⭐⭐⭐⭐ 8/10 |
| 快速简短问答 | `4sapi/claude-sonnet-4-6` | ~1.5s | ⭐⭐⭐⭐ 8/10 |
| 需要强推理/分析 | `4sapi/claude-opus-4-6` | ~1.5s | ⭐⭐⭐⭐⭐ 9/10 |

---

### 4.2 子任务路由（sessions_spawn，后台运行不阻塞主对话）

**调用方式：**
```javascript
sessions_spawn({
  task: "任务描述...",
  runtime: "subagent",
  model: "provider/model-id",
  mode: "run"
})
```

| 任务类型 | 推荐模型 | 备选模型 | 评分 |
|----------|----------|----------|------|
| **长文本分析/总结** (100K+ tokens) | `deepseek/deepseek-chat` (~1s) | `opendoor/gpt-4.1-mini` (~1.4s) | ⭐⭐⭐⭐ 8/10 |
| **代码生成/重构** | `4sapi/claude-opus-4-6` | `deepseek/deepseek-chat` | ⭐⭐⭐⭐⭐ 9/10 |
| **深度推理/思考链** | `deepseek/deepseek-reasoner` | `4sapi/claude-opus-4-6` | ⭐⭐⭐⭐ 8/10 |
| **快速翻译** | `deepseek/deepseek-chat` (~1s) | `minimax/MiniMax-M2.5` (~1s) | ⭐⭐⭐⭐ 8/10 |
| **图片理解** | `ollama/lukey03/qwen3.5-9b-abliterated-vision:latest` (~6s) | - | ⭐⭐⭐ 7/10 |
| **隐私/本地任务** | `ollama/qwen3:30b-a3b` (~26s) | `ollama/huihui_ai/deepseek-r1-abliterated:8b` (~29s) | ⭐⭐⭐ 6/10 |
| **超长上下文** (2000K) | `opendoor/gpt-4.1-mini` | `deepseek/deepseek-chat` (1600K) | ⭐⭐⭐ 7/10 |

---

### 4.3 特殊场景

| 场景 | 推荐模型 | 备注 |
|------|----------|------|
| **极速响应** (<1s) | `nvidia/nvidia/llama-3.1-nemotron-ultra-253b-v1` (~0.7s) | 英文能力强 |
| **高速对话** | `minimax/MiniMax-M2.7` 或 `minimax-cn/MiniMax-M2.5` (~1s) | 支持中文 |
| **Gemini 生成** | `4sapi-gemini/gemini-3-flash` (~2s) | 1000K 上下文 |
| **本地图文理解** | `ollama/lukey03/qwen3.5-9b-abliterated-vision:latest` (~6s) | 完全免费 |

---

### 4.4 Provider 快速跳转

| Provider | 擅长 | Key Model |
|----------|------|----------|
| `4sapi` | Claude 系列 / 代码 / 推理 | `claude-opus-4-6` |
| `deepseek` | 大上下文 / 便宜 / 推理 | `deepseek-chat` |
| `nvidia` | 极速响应 (<1s) | `nemotron-ultra` |
| `opendoor` | 超大上下文 / GPT-4.1 | `gpt-4.1-mini` |
| `minimax` | 高速 / 中文友好 | `MiniMax-M2.7` |
| `ollama` | 本地 / 免费 / 隐私 | `qwen3:30b-a3b` |

---

## 五、当前配置建议

### 主模型
- **当前：** `4sapi/claude-opus-4-6`（已切换）

### 备用链（Fallback）
```
1. 4sapi/claude-sonnet-4-6  (日常快速)
2. deepseek/deepseek-chat    (大上下文/便宜)
3. deepseek/deepseek-reasoner (推理)
4. opendoor/gpt-4.1-mini     (超长上下文备用)
```

### 需修复
- [x] minimax API Key ✅ 已修复
- [x] gemini-3-flash ✅ 已修复

---

## 六、工具功能验证

| 工具 | 状态 | 备注 |
|------|------|------|
| feishu_doc | ✅ | 读写飞书文档 |
| feishu_wiki | ✅ | 飞书知识库 |
| feishu_bitable | ✅ | 飞书多维表格 |
| feishu_drive | ✅ | 飞书云存储 |
| memory_search | ✅ | 记忆检索 |
| web_search | ✅ | Brave 搜索 |
| exec | ✅ | shell 命令 |
| tts | ✅ | 语音合成 |
| image_generate | ✅ | 图像生成 |
| cron | ✅ | 定时任务 |
| sessions_spawn | ✅ | 子任务 |

---

_报告生成：2026-04-04 05:35_
