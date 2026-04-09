# Audio-Stream 系统 SOP

> 远程手机实时录音 → 服务器录制 → 转写 → 摘要 → 逆地理编码 → 邮件发送

---

## 系统概述

| 项目 | 说明 |
|------|------|
| 功能 | 手机浏览器录音，实时传输到服务器，自动转写+摘要+定位，邮件通知 |
| 手机访问 | `https://192.168.31.200:18792/audio-live.html` |
| 协议 | HTTPS + WSS（WebSocket Secure），需自签名证书 |
| 端口 | 18791（HTTP重定向）/ 18792（HTTPS） |
| PM2管理 | `pm2 list audio-stream` / `pm2 restart audio-stream` |
| 定位 | 录音时自动获取 GPS（Geolocation API），精确到区县 |

---

## 服务管理

```bash
# 重启
pm2 restart audio-stream

# 查看状态
pm2 list audio-stream

# 实时日志
pm2 logs audio-stream --lines 50 --nostream

# 端口检查
ss -tlnp | grep -E "18791|18792"
```

---

## 录音文件目录

```
/home/ai/.openclaw/workspace/custom-skills/audio-stream/recordings/
```

每次录音生成 4 个文件：
- `recording_<timestamp>.webm` — 原始录音
- `recording_<timestamp>.mp3` — 转换后音频
- `recording_<timestamp>.txt` — 转写文本
- `recording_<timestamp>_摘要.txt` — 摘要

---

## 完整数据流

```
手机浏览器（Geolocation API 获取 GPS）
    ↓ WebSocket (wss://192.168.31.200:18792/record)
stream-server.js (PM2 audio-stream)
    ↓ 保存 .webm
recordings/
    ↓ 后处理触发（detached subprocess）
audio_post_process.py
    ├─ ffmpeg 转换 mp3
    ├─ transcriber.py
    │   ├─ 优先：阿里云 DashScope Fun-ASR（上传到 litterbox.catbox.moe）
    │   └─ 备用：本地 Whisper CLI（large-v3-turbo）
    ├─ LLM 生成摘要（qwen-max）
    ├─ reverse_geocoder 离线逆地理编码（省/市/区）
    ├─ 写入 video_records 表 (openclaw_memory)
    └─ 邮件发送 (cdlxz2017@qq.com)
```

---

## 数据库表

写入 `openclaw_memory.video_records`：

| 字段 | 说明 |
|------|------|
| filename | 录音文件名 |
| filepath | MP3 完整路径 |
| duration_sec | 时长（秒） |
| file_size_bytes | 文件大小 |
| transcript | 转写文本 |
| transcript_status | done |
| latitude | GPS 纬度 |
| longitude | GPS 经度 |
| location_name | 逆地理地址（例：Sichuan Longquan） |
| email_sent | 是否已发送邮件 |
| email_sent_at | 邮件发送时间 |

---

## 手机端定位显示

录音按钮上方会实时显示定位状态：
- 🟢 `📍 31.23050°N, 121.47500°E` — 定位成功
- 🔴 `📍 定位失败（Permission denied）` — 拒绝权限或GPS不可用

邮件正文包含两行位置信息：
```
坐标：31.23050°N, 121.47500°E
位置：Sichuan Longquan
```

> 注：逆地理编码使用离线库 `reverse_geocoder`，精度到**区县级**，无法精确到镇/街道。如需更精确地址，需接入高德/腾讯地图 API（待实现）。

---

## 组件说明

### stream-server.js
- **作用**：HTTPS 服务器 + WebSocket 服务器，内嵌 HTML 页面
- **路径**：`custom-skills/audio-stream/stream-server.js`
- **端口**：18792（HTTPS），18791（HTTP→HTTPS 重定向）
- **WebSocket 路径**：`/record`（录音），`/`（连通性检测）
- **定位**：接收手机发送的 lat/lng，传给后处理脚本

### audio_post_process.py
- **作用**：录音后处理流水线
- **路径**：`custom-skills/camera-recorder/scripts/audio_post_process.py`
- **调用方式**：`python3 audio_post_process.py <webm_path> [session_id] [lat] [lng]`
- **依赖**：ffmpeg、whisper CLI、summarizer.py、emailer.py、reverse_geocoder

### transcriber.py
- **作用**：语音转写（多引擎回退）
- **主用**：阿里云 DashScope Fun-ASR（`fun-asr` 模型）
  - 音频上传至 `litterbox.catbox.moe`（72h 有效 HTTPS URL）
  - 使用 `dashscope.audio.asr.Transcription` SDK
- **备用**：本地 Whisper CLI（`large-v3-turbo` 模型，~/.cache/whisper/）
- **语言**：中文（普通话）
- **路径**：`custom-skills/camera-recorder/scripts/transcriber.py`

### summarizer.py
- **作用**：LLM 生成摘要
- **模型**：qwen-max（DashScope API）

### emailer.py
- **作用**：发送邮件（转写文本 + 摘要附件 + 位置信息）
- **目标**：cdlxz2017@qq.com

---

## HTTPS 证书

- **密钥**：`custom-skills/audio-stream/key.pem`
- **证书**：`custom-skills/audio-stream/cert.pem`
- 自签名，CN=192.168.31.200
- 手机首次访问需手动接受证书警告

---

## 故障排查

### 手机连不上
1. 确认服务器在线：`ss -tlnp | grep 18792`
2. 确认手机在同一局域网
3. 尝试 `ping 192.168.31.200`

### 录音按钮不显示
1. 清除浏览器缓存后重新访问
2. 检查页面版本：左上角显示 v5
3. 查看调试信息（页面顶部蓝色文字）

### 无法录音（mediaDevices undefined）
1. 页面必须用 **HTTPS** 访问（http 不支持麦克风）
2. 确认浏览器已接受自签名证书
3. 允许浏览器使用麦克风权限

### 录音文件没收到
1. 检查服务器日志：`pm2 logs audio-stream --err --lines 20`
2. 确认手机走的是 `/record` 路径
3. 清除缓存重新访问页面

### 位置显示失败
1. 检查手机浏览器是否允许定位权限
2. 确认手机 GPS 已开启
3. 查看手机浏览器控制台日志

### 逆地理编码无结果
1. `reverse_geocoder` 为离线库，无需网络
2. 精度仅限省/市/区，郊区/小镇可能仅显示区县名
3. 确认数据库 `location_name` 有值

### 转写失败
1. 检查 DashScope API Key 是否有效：`echo $DASHSCOPE_API_KEY`
2. 确认 litterbox.catbox.moe 可访问（上传节点）
3. 备用方案：确认 Whisper 模型已下载：`ls ~/.cache/whisper/`
4. 手动运行测试：`python3 transcriber.py <mp3_path>`

### 邮件没收到
1. 确认 email_sent=true 在数据库中
2. 检查邮件发送日志
3. 检查垃圾邮件文件夹

---

## 更新服务器代码流程

1. 编辑 `stream-server.js` 或 `audio_post_process.py`
2. `pm2 restart audio-stream`
3. 验证端口：`ss -tlnp | grep 18792`
4. 手机清除缓存（硬刷新）后重新访问

---

_最后更新：2026-04-06 19:26_

## 2026-04-06 更新记录

### ASR 切换：有道 ASR → 阿里云 DashScope Fun-ASR
- 有道 ASR API（`openapi.youdao.com/asrapi`）始终返回 errorCode=113（音频校验异常），所有格式/凭证均无法通过
- 改用阿里云 DashScope Fun-ASR：
  - 音频上传至 `litterbox.catbox.moe`（免费临时托管，72h 有效）
  - `Transcription.async_call()` + `Transcription.wait()` SDK 方式
  - 测试：240字转写完整准确
- `transcriber.py` 已重写为双引擎回退：DashScope ASR（主）→ Whisper CLI（备）
- 有道旧凭证保留：openclaw02 / openclaw（ASR 产品未开通，暂不可用）
