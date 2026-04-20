# 有道 TTS / 阿里云 ASR

## 基本信息
- **类型**：语音工具
- **路径**：`custom-skills/youdao-tts/` / `custom-skills/youdao-asr/`
- **来源**：自制
- **状态**：TTS ✅ / ASR ⚠️

## 语音合成（TTS）
| 项 | 值 |
|----|-----|
| 服务 | 有道 TTS API |
| 支持语言 | 中文(zh)/英文(en)/日语(ja)/韩语(ko)等 |
| 输出 | MP3 |
| 调用 | `node .../tts.js "文字" zh /tmp/output.mp3` |

**用途**：微信语音回复（主人说"回复我语音"时调用）

## 语音识别（ASR）
| 项 | 值 |
|----|-----|
| 服务 | 阿里云 DashScope Fun-ASR |
| 模型 | fun-asr |
| 状态 | ✅ 生产可用 |
| API Key | sk-50c8c052... |

**⚠️ 有道 ASR 不可用**：errorCode=113，无论格式/配置均失败。

## 调用流程（TTS + 微信语音）
```
文字 → tts.js 生成 MP3 → message(action=send, channel=openclaw-weixin, media=MP3路径)
```
