# OpenDoor 聚合API文档

来源: https://allinone.apifox.cn/
项目ID: 7484222
API Base: https://api.apifox.com

## API端点目录

- 获取模型 [gemini]
- 文本嵌入 [gemini]
- 获取用户剩余额度 [系统]
- 全局消费统计 [系统]
- 令牌余额查询 [系统]
- 基本请求 [多]
- 流式请求 [多]
- 连续对话 [多]
- 识图请求-url [多]
- 识图请求-base64 [多]
- 工具（函数）调用 [多]
- 文档重排序 [多]
- 流式出图/视频 [GPT-5.1/多]
- gpt-5.1开思考显示 [GPT-5.1]
- codex模型请求 [Codex]
- chat兼容思考显示 [多]
- 视频识别 [多]
- PDF识别 [多]
- 结构化输出 [多]
- OpenAI chat格式 [OpenAI]
- 流式出图/视频（推荐） [多]
- Google 生图-nano/banana [Google]
- Google Gemini生图 [Gemini]
- Google Gemini改图 [Gemini]
- OpenAI image格式 [OpenAI]
- OpenAI sora格式 [OpenAI/Sora]
- Midjourney绘图 [Midjourney]
- 豆包Seedream生图 [豆包]
- Grok image格式 [Grok]
- Grok视频格式 [Grok]
- 音频转录 [多]
- 音频翻译 [多]
- 文本转语音(TTS) [Gemini]
- Gemini原生格式 [Gemini]
- Anthropic原生格式 [Anthropic]
- OpenAI对话格式-chat [OpenAI]
- OpenAI对话格式-responses [OpenAI]
- Claude对话格式-messages [Claude]
- Gemini对话格式-v1beta [Gemini]

## 数据模型

- ErrorResponse
- ModelsResponse
- GeminiModelsResponse
- ChatCompletionRequest
- ChatCompletionResponse
- CompletionRequest
- CompletionResponse
- ResponsesRequest
- ResponsesResponse
- ClaudeRequest
- ClaudeResponse
- EmbeddingRequest
- EmbeddingResponse
- ImageGenerationRequest
- ImageResponse
- AudioTranscriptionResponse
- SpeechRequest
- RerankRequest
- RerankResponse
- VideoRequest
- ModerationRequest
- VideoResponse
- ModerationResponse
- VideoTaskResponse
- GeminiRequest
- GeminiResponse
- OpenAIVideoError
- Model
- Message
- MessageContent
- ToolCall
- Tool
- ResponseFormat
- Usage
- ClaudeMessage
- VideoTaskMetadata
- VideoTaskError
- ChatCompletionStreamResponse
- ResponsesStreamResponse
- ImageEditRequest
- AudioTranscriptionRequest
- AudioTranslationRequest
- OpenAIVideo