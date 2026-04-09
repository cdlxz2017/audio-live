# 有道 TTS Skill

把文字转成语音 MP3 文件。

## 调用方式

```bash
node /home/ai/.openclaw/workspace/custom-skills/youdao-tts/scripts/tts.js "要转换的文字" [语言] [输出文件]
```

- 语言代码：zh(中文)、en(英语)、ja(日语)、ko(韩语)、fr(法语)、de(德语)、ru(俄语)、es(西班牙语)
- 默认语言：zh
- 输出：MP3 文件路径，或 stdout 输出 base64

## 示例

```bash
# 生成中文语音
node /home/ai/.openclaw/workspace/custom-skills/youdao-tts/scripts/tts.js "你好，欢迎使用语音合成" zh /tmp/output.mp3

# 生成英文语音
node /home/ai/.openclaw/workspace/custom-skills/youdao-tts/scripts/tts.js "Hello world" en /tmp/output.mp3
```

## 用途

当用户说「回复我语音」「发语音」「用语音回复」时：
1. 用此脚本把回复文字转成 MP3
2. 通过 `message(action=send, channel=openclaw-weixin, target=<用户ID>, media=<MP3路径>)` 发送
3. 同时发送文字回复
