# 大模型路由策略

## 基本信息
- **类型**：配置 / API 路由
- **状态**：✅ 已配置（2026-04-04 实测）

## 可用模型清单

### T1 主力
| 模型 | 速度 | 评分 | 最佳场景 | 状态 |
|------|------|------|---------|------|
| 4sapi/claude-opus-4-6 | ~1.5s | 9/10 | 代码/推理/分析 | ✅ |
| 4sapi/claude-sonnet-4-6 | ~1.5s | 8/10 | 日常对话 | ✅ |

### T2 替补
| 模型 | 速度 | 评分 | 最佳场景 | 状态 |
|------|------|------|---------|------|
| deepseek/deepseek-reasoner | ~1.5s | 8/10 | 深度推理 | ✅ |
| deepseek/deepseek-chat | ~1s | 8/10 | 快速问答/翻译 | ✅ |

### T3 替补
| 模型 | 速度 | 评分 | 最佳场景 | 状态 |
|------|------|------|---------|------|
| nvidia/kimi-k2 | ~1.7s | 7/10 | 快速响应 | ✅ |
| opendoor/gpt-4.1-mini | ~1.4s | 7/10 | 超大上下文(2M) | ✅ |

### 不可用
| 模型 | 原因 | 状态 |
|------|------|------|
| minimax/MiniMax-M2.7 | API Key 格式错误 | ❌ |
| minimax-cn/MiniMax-M2.5 | 同上 | ❌ |
| 4sapi-gemini/gemini-3-flash | 无权限 | ❌ |

## 子任务路由策略
| 任务类型 | 推荐模型 |
|---------|---------|
| 长文本分析 | deepseek/deepseek-chat (1600K 上下文) |
| 代码生成 | 4sapi/claude-opus-4-6 |
| 深度推理 | deepseek/deepseek-reasoner |
| 快速翻译 | deepseek/deepseek-chat |
| 隐私任务 | ollama/qwen3:30b-a3b |
