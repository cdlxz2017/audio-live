# 危险点：模型不可用导致团队模式失败

## 风险描述
需要团队模式时，如果 API 模型全部不可用（网络问题、API 限流、Key 失效等），团队无法组建。

## 影响
- 严重程度：中
- 影响范围：所有需要团队协作的任务

## 规避措施
1. 拉起团队前实时探测各模型可用性
2. 建立降级链路：T1 → T2 → T3
3. 所有 API 不可用时，降级为单 AI 执行
4. 不使用本地 Ollama 兜底（主人要求）

## 应急方案
1. 通知主人模型状态
2. 改用单 AI 模式走标准完整通道
3. 记录失败原因到本文件

## 历史案例
| 日期 | 场景 | 是否触发 | 结果 |
|------|------|---------|------|
| 2026-04-19 | SOP 设计期间 minimax API Key 错误 | ✅ | minimax 被标记不可用，使用 Claude/DeepSeek |

---

# 危险点：Session 中断导致进度丢失

## 风险描述
执行过程中 session 中断（网络断开、/new 命令等），正在进行的工作可能丢失。

## 影响
- 严重程度：中
- 影响范围：所有 Complex/Standard 任务

## 规避措施
1. 副脑 Thread 实时更新进度
2. 每次完成一步立即更新 Thread 的 implementation stage
3. 新 session 启动时检查副脑 active threads
4. 从中断点继续，不从头开始

## 应急方案
1. 新 session 启动 → 检查副脑 active threads
2. 找到状态为 in_progress 的 Thread
3. 读取 implementation stage 了解进度
4. 从中断的步骤继续

## 历史案例
| 日期 | 场景 | 是否触发 | 结果 |
|------|------|---------|------|
| 2026-04-19 | 本次 SOP 搭建过程 | 预防中 | Thread 实时更新进度 |

---

# 危险点：before_message_write hook 对 assistant 消息无效

## 风险描述
OpenClaw Gateway 的 before_message_write hook 对 webchat assistant 消息无效，导致 assistant 消息不会被自动捕获到 conversation_messages 表。

## 影响
- 严重程度：中
- 影响范围：记忆系统的对话捕获完整性

## 规避措施
1. assistant 消息依赖 extractor 从 JSONL 文件读取
2. 有 30 秒延迟（文件扫描轮询周期）
3. 这是已知限制，不做修复

## 历史案例
| 日期 | 场景 | 结果 |
|------|------|------|
| 2026-04-18 | 会话捕获分析 | 确认为设计限制，SessionManager.appendInjectedAssistantMessageToTranscript 绕过 hook |
