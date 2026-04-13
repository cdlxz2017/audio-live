# 4G语音通讯系统 v2

基于A7670G 4G模块的完整语音通讯系统，实现4个功能模块。

## 系统架构

```
v2/
├── src/
│   ├── __init__.py
│   ├── config.py          # 配置管理（从config.yaml加载）
│   ├── db.py              # PostgreSQL连接池
│   ├── contacts_db.py     # 通讯录CRUD
│   ├── sms_db.py          # 短信存储
│   ├── at_commands.py     # AT命令封装
│   ├── audio_recorder.py  # 录音（增益控制+质量检测）
│   ├── transcriber.py      # Whisper本地转写
│   ├── summarizer.py       # LLM摘要
│   ├── notifier.py        # 微信推送
│   ├── voice_listener.py  # 来电监听主进程
│   ├── sms_handler.py     # 短信接收处理
│   ├── outbound_handler.py # 外呼处理
│   └── tts_client.py       # Edge-TTS封装
├── cli/
│   └── voice_cli.py       # 主CLI入口
├── sql/
│   └── init.sql           # 数据库初始化
└── ecosystem.v2.yaml      # PM2配置
```

## 硬件环境

- AT命令口：`/dev/ttyUSB1` (115200)
- 短信口：`/dev/ttyUSB2` (115200)
- 录音设备：`plughw:1,0` (ALC245 Analog)
- 音频输出：`plughw:0,3` (HDMI)
- PostgreSQL：`localhost:5432/openclaw_memory`

## 快速开始

### 1. 初始化数据库

```bash
psql postgresql://openclaw_ai:zyxrcy910128@localhost:5432/openclaw_memory -f sql/init.sql
```

### 2. 配置API Key

编辑 `config.yaml`，填入实际API Key：
```yaml
llm:
  api_key: YOUR_ACTUAL_KEY
```

### 3. 安装依赖

```bash
pip install psycopg2-binary pyyaml whisper edge-tts
```

### 4. 启动监听进程

```bash
# PM2启动
pm2 start ecosystem.v2.yaml

# 或手动前台启动
python3 -m src.voice_listener
```

## CLI命令

### 通讯录管理

```bash
# 添加联系人
voice-cli contact add --name "老妈" --phone "13980819087" --relationship "家人" --importance 2

# 列出通讯录
voice-cli contact list

# 搜索联系人
voice-cli contact search "老妈"

# 黑名单/白名单
voice-cli contact blacklist 13980819087
voice-cli contact whitelist 13980819087

# 删除
voice-cli contact delete 13980819087
```

### 通话

```bash
# 拨号（通讯录姓名）
voice-cli call dial --name "老妈"

# 拨号（直接号码）
voice-cli call dial --phone 13980819087

# 拨号 + TTS语音（对方可听到）
voice-cli call dial --phone 13980819087 --tts "你好，这是一条测试消息"

# 播放录音给通话对方
voice-cli call play /path/to/recording.wav

# TTS播放
voice-cli call tts "今晚回来吃饭"
```

### 短信

```bash
# 发送短信
voice-cli sms send --phone 13980819087 --content "你好"

# 群发
voice-cli sms group --phones "13900000001,13900000002" --content "明天开会"

# 查看历史
voice-cli sms list
voice-cli sms list --contact "老妈"
```

## 4个模块说明

### 模块1：通讯录（contacts_db.py）

- PostgreSQL存储，phone_normalized唯一索引
- 号码标准化（去+86/空格/横线/括号）
- 后7位模糊匹配兜底
- 黑名单自动挂断，白名单跳过振铃直接接听

### 模块2：来电处理 + 录音 + 转写 + 推送

**关键修复（vs 原系统）：**
- 录音增益：`-v 0.3`（30%，防clipping）
- 采样率：16000Hz（与Whisper一致，避免二次转码）
- 音频质量检测：ffmpeg volumedetect，max_volume > -1dB标记失真
- loudnorm标准化到-3dB峰值

**流程：**
```
来电 → 识别通讯录 → 黑名单检查 → 自动接听
→ 录音(16kHz S16_LE) → 通话结束
→ 质量检测 + 标准化 → Whisper转写 → LLM摘要 → 微信推送
```

### 模块3：外呼 + TTS播放

**注意：** TTS播放给对方的方案需要3.5mm音频线物理连接：
```
Edge-TTS WAV → ffmpeg → HDMI输出(plughw:0,3) → 3.5mm公对公 → 模块MIC输入 → 对方听到
```

如果硬件未连接，播放会失败但不影响录音（能录到对方声音）。

### 模块4：短信

- PDU解码复用 `4g-sms-decode.py`
- Text模式发送（AT+CMGF=1 + AT+CSCS="UCS2"）
- 异步处理：存DB → 微信推送

## PM2管理

```bash
# 启动
pm2 start ecosystem.v2.yaml

# 查看状态
pm2 list

# 查看日志
pm2 logs voice-listener
pm2 logs voice-sms-handler

# 重启
pm2 restart voice-listener

# 停止
pm2 stop all
```

## 日志目录

```
/home/ai/.openclaw/workspace/logs/voice-v2/
├── listener.log          # 来电监听主日志
├── recorder.log          # 录音日志
├── transcriber.log       # Whisper转写日志
├── summarizer.log        # LLM摘要日志
├── notifier.log          # 微信推送日志
├── sms_handler.log       # 短信处理日志
├── outbound.log          # 外呼日志
├── tts.log               # TTS日志
├── at.log                # AT命令日志
└── pm2-*.log             # PM2进程日志
```

## 录音文件

```
/home/ai/.openclaw/workspace/voice-system/recordings/
├── inbound/   # 来电录音
└── outbound/  # 外呼录音
```

## 已知限制

1. **TTS物理环回**：需要3.5mm音频线连接HDMI输出到模块MIC，未连接时TTS播放失败但通话正常
2. **API Key**：需在config.yaml中配置MiniMax API Key才能使用LLM摘要
3. **录音时长**：max_recording_duration由通话实际时长决定
