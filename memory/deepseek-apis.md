# DeepSeek API 文档汇总

来源: https://api-docs.deepseek.com/zh-cn/

## 基本信息
- Base URL: https://api.deepseek.com
- API Key: 需从 https://platform.deepseek.com/api_keys 获取
- 兼容: OpenAI SDK

## 支持模型
- deepseek-chat (DeepSeek-V3.2, 128K 上下文, 非思考模式)
- deepseek-reasoner (DeepSeek-V3.2, 思考模式)

## API 列表

### 对话 API
- POST /chat/completions (与 OpenAI 兼容)

### 指南
- Anthropic API 兼容模式
- 对话前缀续写 (Chat Prefix Completion)
- FIM 补全 (Fill-in-the-middle)
- JSON Output 模式
- 上下文硬盘缓存 (KV Cache)
- 多轮对话
- 思考模式 (Reasoning)
- Tool Calls

### 快速入门
- 参数设置
- 错误码
- 价格
- 限速
- Token 用量计算

