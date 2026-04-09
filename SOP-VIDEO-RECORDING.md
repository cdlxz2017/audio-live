# 摄像头录制系统 SOP v1.0

> 建立日期：2026-04-06
> 版本：v1.1
> 负责人：AI 助手
> 最后更新：2026-04-06

---

## 1. 系统概述

### 1.1 功能目标

对 OBSBOT Tiny 2 摄像头进行高质量视频录制，自动进行语音转写 + 要点摘要，记录到数据库，并通过邮件发送转写和摘要两个附件。

### 1.2 技术规格

| 项目 | 参数 |
|------|------|
| 摄像头 | OBSBOT Tiny 2（USB，/dev/video0） |
| 麦克风 | OBSBOT Tiny 2 USB Audio（ALSA card 2） |
| 视频编码 | H.265 (libx265)，CRF 23，max 2Mbps |
| 音频编码 | AAC，128kbps，48kHz，单声道 |
| 录制分辨率 | 1920×1080 @ 30fps |
| 存储路径 | ~/videos/ |
| 文件名格式 | YYYY-MM-DD_HHMMSS.mp4 |
| 预估体积 | ~540MB/h（相比 H.264 直复制减少 93%） |

### 1.3 系统组件

```
摄像头录制系统
├── port_detector.py   # 端口检测 + 热插拔识别
├── recorder.py        # ffmpeg 录制核心
├── transcriber.py     # Whisper 语音转写
├── summarizer.py      # LLM 要点摘要生成
├── db.py              # video_records 数据库操作
├── emailer.py         # 邮件发送（带附件）
├── post_record.py     # 录制后处理（转写→摘要→邮件，独立进程）
├── camera.py          # 统一命令行入口
└── config.json        # 配置文件
```

---

## 2. 录制命令

### 2.1 基础命令

```bash
# 打开摄像头预览（不录制）
python3 custom-skills/camera-recorder/scripts/camera.py open

# 开始录制
python3 custom-skills/camera-recorder/scripts/camera.py start

# 查看录制状态
python3 custom-skills/camera-recorder/scripts/camera.py status

# 停止录制（自动保存视频）
python3 custom-skills/camera-recorder/scripts/camera.py stop
```

### 2.2 命令详细说明

| 命令 | 功能 | 注意事项 |
|------|------|---------|
| `open` | 打开摄像头预览流（ffplay 窗口） | 预览窗口出现在屏幕 (100, 100) 位置 |
| `start` | 检测端口 + 启动录制 | 自动识别 video0 + ALSA card 2；每个 session 只允许一个录制进程 |
| `stop` | 停止录制 + 保存 + 转写 + 摘要 + 邮件 | 录制进程终止，文件写入 ~/videos/；后处理独立进程运行（nohup） |
| `status` | 查看当前录制状态 | 显示设备、开始时间、已录制时长 |

---

## 3. 录制流程（标准操作）

### 3.1 准备检查

**每次录制前必须执行：**

```bash
# Step 1: 检查端口状态
python3 custom-skills/camera-recorder/scripts/port_detector.py --list

# 预期输出：
# === 视频设备 ===
# /dev/video0: OBSBOT Tiny 2: OBSBOT Tiny 2 St
# /dev/video1: OBSBOT Tiny 2: OBSBOT Tiny 2 St
# === 音频设备 ===
# card 2: OBSBOT Tiny 2

# Step 2: 检查磁盘空间
df -h ~/videos

# 确认可用空间 > 1GB
```

### 3.2 开始录制

```bash
# Step 3: 开始录制
python3 custom-skills/camera-recorder/scripts/camera.py start

# 预期输出：
# OK: 开始录制 (device=/dev/video0, audio=hw:2) -> PID:XXXXX
```

### 3.3 录制过程监控

```bash
# 每 30 分钟检查一次录制状态
python3 custom-skills/camera-recorder/scripts/camera.py status

# 检查 ffmpeg 进程是否存活
ps aux | grep "[f]fmpeg.*v4l2"

# 检查文件大小增长
ls -lh ~/videos/$(date +%Y-%m-%d)_*.mp4
```

### 3.4 停止录制

```bash
# Step N: 停止录制
python3 custom-skills/camera-recorder/scripts/camera.py stop

# 预期输出：
# OK: 录制已停止，文件: YYYY-MM-DD_HHMMSS.mp4 (Xs, YMB)，转写处理中
```

---

## 4. 录制后处理流程

`camera.py stop` 后自动触发 `post_record.py`（nohup 独立进程），全流程：
**转写文件 → LLM摘要文件 → 数据库更新 → 邮件附件发送**

```
录制停止
  ↓
post_record.py (nohup 独立进程，PPID=1，不受主session影响)
  ↓
Whisper 转写 → 写入 YYYY-MM-DD_HHMMSS.mp4.txt
  ↓
LLM (Qwen-max) 生成摘要 → 写入 YYYY-MM-DD_HHMMSS.mp4_摘要.txt
  ↓
数据库 video_records 更新 transcript
  ↓
邮件发送至 cdlxz2017@qq.com（正文含摘要，附件含转写+摘要两个.txt）
  ↓
数据库 email_sent 更新
```

### 4.1 转写（手动）

```bash
# 手动转写（large-v3-turbo，普通话）
whisper \
  /home/ai/videos/YYYY-MM-DD_HHMMSS.mp4 \
  --model large-v3-turbo \
  --model_dir ~/.cache/whisper \
  --language zh \
  --task transcribe \
  --output_dir /home/ai/videos \
  --output_format txt \
  --fp16 False

# 转写结果保存在同目录 .txt 文件
```

### 4.2 手动后处理

```bash
# 手动触发完整后处理（独立进程）
nohup python3 custom-skills/camera-recorder/scripts/post_record.py \
  /home/ai/videos/YYYY-MM-DD_HHMMSS.mp4 <时长秒> <filename> &

# 单独生成摘要
python3 custom-skills/camera-recorder/scripts/summarizer.py \
  /home/ai/videos/YYYY-MM-DD_HHMMSS.mp4.txt
```

### 4.3 数据库记录

```bash
# 手动插入记录
python3 custom-skills/camera-recorder/scripts/db.py insert \
  "YYYY-MM-DD_HHMMSS.mp4" \
  "/home/ai/videos/YYYY-MM-DD_HHMMSS.mp4" \
  <时长秒数> \
  <文件大小字节数>

# 查看所有记录
python3 custom-skills/camera-recorder/scripts/db.py list

# 更新转写状态
python3 custom-skills/camera-recorder/scripts/db.py transcript <record_id> "<转写文字>"

# 标记邮件已发送
python3 custom-skills/camera-recorder/scripts/db.py email-sent <record_id>
```

### 4.4 邮件发送

邮件自动发送至 cdlxz2017@qq.com，附件包含两个 .txt 文件：
- `YYYY-MM-DD_HHMMSS.mp4.txt` — 完整转写文本
- `YYYY-MM-DD_HHMMSS.mp4_摘要.txt` — LLM 要点摘要

邮件正文含要点摘要内容。

---

## 5. 配置说明

### 5.1 配置文件

路径：`custom-skills/camera-recorder/config.json`

```json
{
  "video_dir": "/home/ai/videos",
  "email_to": "cdlxz2017@qq.com",
  "motion_still_threshold_sec": 180,
  "video_codec": "libx265",
  "h265_crf": 23,
  "video_maxrate": "2M",
  "video_bufsize": "4M",
  "ffmpeg_audio_bitrate": "128k",
  "ffmpeg_sample_rate": 48000,
  "whisper_model": "large-v3-turbo",
  "disk_space_min_gb": 1,
  "db": {
    "host": "localhost",
    "port": 5432,
    "user": "openclaw_ai",
    "password": "zyxrcy910128",
    "database": "openclaw_memory"
  }
}
```

### 5.2 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `h265_crf` | 23 | 质量等级，越小质量越高（18-28 之间） |
| `video_maxrate` | 2M | 视频最大码率 |
| `motion_still_threshold_sec` | 180 | 静止超时秒数（默认 180s） |
| `disk_space_min_gb` | 1 | 磁盘空间预警阈值 |

---

## 6. 数据库表结构

```sql
CREATE TABLE IF NOT EXISTS video_records (
  id              BIGSERIAL PRIMARY KEY,
  filename        TEXT NOT NULL,
  filepath        TEXT NOT NULL,
  duration_sec    INTEGER,
  resolution      TEXT,
  file_size_bytes BIGINT,
  transcript      TEXT,
  transcript_status TEXT DEFAULT 'pending',  -- pending / done / failed
  email_sent      BOOLEAN DEFAULT false,
  email_sent_at   TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

---

## 7. 已知问题与限制

### 7.1 已确认问题

| 问题 | 原因 | 影响 | 状态 |
|------|------|------|------|
| stop 后异步转写偶尔不触发 | exec session 结束时线程被中断 | 需手动触发转写 | 已知局限 |
| V4L2 设备互斥锁 | 内核级别，同一时间只能一个进程打开 | 无法同时读 H.264 流做 OpenCV 检测 | 已用文件增长率法规避 |
| 端口检测依赖 /dev/video* | 热插拔后需重新检测 | 录制中途拔摄像头会中断 | 设计如此 |

### 7.2 录制限制

- 录制过程中不要拔掉摄像头
- 磁盘空间低于 1GB 时 start 会拒绝录制
- 每个 session 只允许一个录制进程

---

## 8. 文件路径速查

| 文件 | 路径 |
|------|------|
| Skill 根目录 | `custom-skills/camera-recorder/` |
| 命令行入口 | `scripts/camera.py` |
| 端口检测 | `scripts/port_detector.py` |
| 录制核心 | `scripts/recorder.py` |
| 转写 | `scripts/transcriber.py` |
| 摘要生成 | `scripts/summarizer.py` |
| 后处理 | `scripts/post_record.py` |
| 数据库 | `scripts/db.py` |
| 邮件 | `scripts/emailer.py` |
| 配置 | `config.json` |
| 视频存储 | `~/videos/` |
| Whisper 模型 | `~/.cache/whisper/large-v3-turbo.pt` |

---

## 9. 快速参考（录制时使用）

```
开始录制：
python3 custom-skills/camera-recorder/scripts/camera.py start

停止录制：
python3 custom-skills/camera-recorder/scripts/camera.py stop

检查状态：
python3 custom-skills/camera-recorder/scripts/camera.py status
```
