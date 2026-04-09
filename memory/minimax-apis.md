# MiniMax 开放平台 API 文档汇总

来源: https://platform.minimaxi.com/docs/api-reference/

## 服务信息
- API Key: sk-cp-6fK-TWGeJV1NhnYfmtiTeghLHfbaiT_h53vs4LdPqSKCIXiybOmPNTDXhCeK1cjfRebRGDfV4eOJMn9MuCWcamUmD4J8RAoLOIWeM7e12rbG-f3wMRECpnM
- API Base URL: https://api.minimaxi.com
- TTS Endpoint: /v1/t2a_v2

## 支持模型

### 文本模型
- MiniMax-M2.7 (204800 tokens, ~60tps)
- MiniMax-M2.7-highspeed (204800 tokens, ~100tps)
- MiniMax-M2.5 (204800 tokens)
- MiniMax-M2.5-highspeed
- MiniMax-M2.1 (204800 tokens)
- MiniMax-M2.1-highspeed
- MiniMax-M2 (高效编码/Agent)

### 语音合成模型
- speech-2.8-hd (HD, 精准还原语气细节)
- speech-2.8-turbo (Turbo, 低时延)
- speech-2.6-hd
- speech-2.6-turbo
- speech-02-hd (出色韵律/稳定性/复刻相似度)
- speech-02-turbo (小语种能力加强)

## API 分类

### 文本 (Text)
- Anthropic API 兼容 (推荐)
- OpenAI API 兼容
- 文本对话 /text_post
- Prompt 缓存

### 语音合成 (T2A)
- 同步语音合成 HTTP: POST /v1/t2a_v2
- 同步语音合成 WebSocket
- 异步长文本语音生成
- 音色快速复刻
- 音色设计

### 视频生成 (Video)
- 文生视频
- 图生视频
- 首尾帧生成视频
- 主体参考视频生成

### 图像 (Image)
- 文生图 (T2I)
- 图生图 (I2I)

### 文件管理
- 上传/下载/列表/删除

