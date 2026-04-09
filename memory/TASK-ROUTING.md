# 任务分发路由策略

> 根据大模型能力进行智能路由，优先使用免费/已验证/高质量方案

## API 能力现状（2026-04-04 实测）

| API | 功能 | 状态 | 延迟 | 成本 | 备注 |
|-----|------|------|------|------|------|
| **MiniMax** | 文本对话 | ✅ | ~800ms | 按量 | qwen-max / deepseek-v3 |
| **Youdao** | TTS 中文 | ✅ | 快 | 收费 | openapi.youdao.com/ttsapi |
| **Youdao** | ASR | ⚠️ 待测 | — | 收费 | openapi.youdao.com/asrapi |
| **Youdao** | 翻译 | ❌ 签名失败 | — | — | 服务可能未开通 |
| **Edge-TTS** | TTS 多语种 | ✅ | 快 | 免费 | /home/ai/ocr-env/bin/edge-tts |
| **Ollama 本地** | Whisper ASR | ✅ | 本地 | 免费 | bge-m3 向量模型已装 |
| **Ollama 本地** | Embedding | ✅ | 本地 | 免费 | localhost:11434 |

---

## 路由规则

### 🔤 文字对话
```
优先级1: MiniMax qwen-max (已验证可用)
优先级2: DeepSeek (需配置key)
优先级3: OpenAI via 4sapi (需配置key)
```

### 🎤 语音合成 (TTS)
```
中文语音:
  优先级1: Youdao TTS ✅ (已验证, 有道智云)
  优先级2: Edge-TTS (免费, 需网络)
英文/多语种:
  优先级1: Edge-TTS ✅ (免费, Neural语音)
  优先级2: MiniMax TTS (token不支持, 需升级)
```

### 🎙️ 语音识别 (ASR)
```
优先级1: Ollama Whisper本地 (免费, 无需网络)
优先级2: Youdao ASR (待配置测试)
```

### 🌐 翻译
```
优先级1: Youdao 翻译 (待重新测试)
优先级2: MiniMax (via 对话)
```

### 🖼️ 图像生成
```
优先级1: MiniMax 图像生成 (待测试)
优先级2: 4sapi Midjourney (需配置key)
```

### 🎬 视频生成
```
优先级1: 4sapi Sora/Veo 通道 (需配置key)
```

### 📄 文档分析 / 长文本
```
优先级1: DeepSeek-V3 (128K上下文)
优先级2: MiniMax qwen-long (待测试)
```

### 🔍 联网搜索
```
优先级1: MiniMax + 联网 (via 4sapi)
优先级2: DeepSeek + 联网
```

---

## 子任务执行机制

### 使用方式
当用户请求需要较长处理时间的任务时，自动使用子任务：

```
/bg <任务描述>   → 后台执行，结果推送
/sync <任务>     → 同步执行，结果直接回复
```

### 触发关键词
- "测试一下xxx"、"帮我查一下xxx" → 同步执行
- "分析大量数据"、"生成报告"、"批量处理" → 子任务
- "翻译这篇文章"、"帮我写代码" → 同步执行（短任务）

### 执行脚本
```bash
# 子任务执行入口
node /home/ai/.openclaw/workspace/custom-skills/task-router/scripts/delegate.js <模型> <任务类型> <参数>

# 可用模型别名
minimax-text    → MiniMax 文本对话
minimax-tts     → MiniMax TTS  
youdao-tts      → Youdao TTS
youdao-asr      → Youdao ASR
edge-tts         → Edge-TTS
whisper          → Ollama Whisper ASR
```

---

## 评分矩阵

### 文本对话评分 (满分10)

| 模型 | 质量 | 速度 | 成本 | 稳定性 | 易用性 | 综合 |
|------|------|------|------|--------|--------|------|
| MiniMax qwen-max | 9 | 8 | 7 | 9 | 9 | 8.4 |
| DeepSeek-V3 | 9 | 9 | 10 | 8 | 8 | 8.8 |

### 语音合成评分 (满分10)

| 模型 | 质量 | 速度 | 成本 | 稳定性 | 易用性 | 综合 |
|------|------|------|------|--------|--------|------|
| Youdao TTS | 8 | 9 | 6 | 9 | 9 | 8.2 |
| Edge-TTS | 9 | 9 | 10 | 7 | 7 | 8.4 |
| MiniMax TTS | — | — | — | — | — | N/A(未开通) |

### 语音识别评分 (满分10)

| 模型 | 质量 | 速度 | 成本 | 稳定性 | 易用性 | 综合 |
|------|------|------|------|--------|--------|------|
| Ollama Whisper | 8 | 10(本地) | 10 | 9 | 6 | 8.6 |
| Youdao ASR | 8 | 8 | 6 | 8 | 8 | 7.6 |

---

## 配置文件

- 路由脚本: `custom-skills/task-router/scripts/delegate.js`
- API凭证: 见 `memory/technical.md`
- 能力测试结果: `memory/API-CAPABILITIES.md`
