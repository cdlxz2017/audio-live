# API 能力检测报告
> 更新时间: 2026-04-04 05:12

## 实测结果

| 状态 | API | 功能 | 延迟 | 备注 |
|------|-----|------|------|------|
| ✅ | MiniMax | 文本对话 | 826ms | qwen-max / deepseek-v3.2 可用 |
| ✅ | MiniMax | 图像生成 | 16s | image-01 模型正常 |
| ❌ | MiniMax | TTS 语音合成 | — | token plan 不支持 |
| ❌ | MiniMax | 视频生成 | 316ms | token plan 不支持 video-01 |
| ✅ | Youdao | TTS 语音合成 | <1s | openapi.youdao.com/ttsapi |
| ⚠️ | Youdao | ASR 语音识别 | — | API 可达，待音频测试 |
| ❌ | Youdao | 翻译 | — | 签名校验失败，服务未开通 |
| ⚠️ | Youdao | OCR | — | 待测试 |
| ✅ | Edge-TTS | TTS 多语种 | <3s | 免费，Neural 语音 |
| ✅ | Ollama 本地 | Whisper ASR | 本地 | bge-m3 向量模型 |
| ✅ | Ollama 本地 | Embedding | 本地 | localhost:11434 |

---

## 评分矩阵

| 模型/功能 | 质量 | 速度 | 成本 | 稳定性 | 易用性 | 综合 |
|-----------|------|------|------|--------|--------|------|
| MiniMax qwen-max / 文本对话 | 9 | 8 | 7 | 9 | 9 | **8.4** |
| MiniMax image-01 / 图像生成 | 8 | 5 | 7 | 9 | 9 | **7.6** |
| Youdao TTS / 语音合成 | 8 | 9 | 6 | 9 | 9 | **8.2** |
| Edge-TTS / 语音合成 | 9 | 9 | 10 | 7 | 7 | **8.4** |
| Ollama Whisper / 语音识别 | 8 | 10 | 10 | 9 | 6 | **8.6** |

---

## 路由策略

```
文字对话 → MiniMax qwen-max（✅已验证）
长文本分析 → DeepSeek（需配置key）
图像生成 → MiniMax image-01（✅已验证）
视频生成 → 4sapi Sora（需key）
语音合成 → Youdao TTS（中文✅）/ Edge-TTS（英文/免费✅）
语音识别 → Ollama Whisper（本地免费✅）/ Youdao ASR（⚠️待测）
翻译 → Youdao（❌失败）/ MiniMax 对话
```

---

## 待配置 Key

| 服务 | 用途 | 状态 |
|------|------|------|
| DeepSeek | 文本对话/长上下文 | 无 Key |
| 4sapi | Midjourney/Sora/视频 | 无 Key |
| Aliyun 百炼 | qwen-coder 等 | 无 Key |
| Youdao 翻译 | 中英互译 | 签名失败，待查 |
| Youdao ASR | 语音识别 | 待音频测试 |
