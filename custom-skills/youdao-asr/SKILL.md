# 有道 ASR Skill

> ⚠️ **注意**：有道 ASR API（openapi.youdao.com/asrapi）返回 errorCode=113（音频数据校验异常），
> 无论音频格式/长度/凭证如何配置均无法通过。
> 当前系统已改用 **阿里云 DashScope Fun-ASR** 作为主用 ASR（见下方配置）。

---

## 阿里云 DashScope Fun-ASR 配置（当前生产环境使用）

| 项目 | 值 |
|------|-----|
| API Key | `sk-50c8c0524a8244ffbdcb9131545dfa56` |
| API Base | `https://dashscope.aliyuncs.com/api/v1` |
| 模型 | `fun-asr` |
| 语言 | 中文（`zh`） |

### 调用流程

1. 音频上传到 `litterbox.catbox.moe`（免费临时存储，72h有效）
2. 提交异步转写任务（`Transcription.async_call`）
3. SDK 内部轮询等待完成（`Transcription.wait`）
4. 从结果 URL 解析转写文本

### SDK 用法

```python
from dashscope.audio.asr import Transcription
from http import HTTPStatus

# 提交
task_resp = Transcription.async_call(
    model='fun-asr',
    file_urls=['https://...'],
    language_hints=['zh']
)
# 等待
result = Transcription.wait(task=task_id)
# 解析
for r in result.output.results:
    if r['subtask_status'] == 'SUCCEEDED':
        url = r['transcription_url']
        # 下载并解析
```

---

## 旧配置（有道 ASR - 待排查）

### 凭证
| 应用 | APP_ID | APP_SECRET |
|------|--------|-----------|
| openclaw02 | `7e204efbc4c127a5` | `Htf7xPB0ANwZi2JBfZ3xqwkLCu7YMtIg` |
| openclaw | `28eb4e39cf5a208c` | `ZhLRUFkIl2IGr1z4Ck41ocVEl2pMBE2b` |

### 端点
- **ASR API**: `https://openapi.youdao.com/asrapi`
- **状态**: API可达但音频校验失败（errorCode=113）

### 已知问题
- 无论使用何种音频格式（PCM/WAV/MP3/OGG），均返回 `errorCode=113`
- 可能原因：ASR 产品未在有道智云控制台开通
