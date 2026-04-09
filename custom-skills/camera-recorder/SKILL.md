# Camera Recorder Skill

摄像头录制系统，支持高质量视频录制、语音转写、数据库记录、邮件发送。

## 环境要求

- ffmpeg (with libx265)
- whisper CLI (`~/.local/bin/whisper`)
- Python 3 (numpy, 标准库)
- PostgreSQL video_records 表

## 配置 (config.json)

```json
{
  "video_dir": "~/videos",
  "email_to": "cdlxz2017@qq.com",
  "motion_still_threshold_sec": 180,
  "h265_crf": 28,
  "whisper_model": "large-v3-turbo",
  "db": {
    "host": "localhost",
    "port": 5432,
    "user": "openclaw_ai",
    "password": "zyxrcy910128",
    "database": "openclaw_memory"
  }
}
```

## 命令

| 命令 | 功能 |
|------|------|
| `打开摄像头` | 检测端口，启动摄像头预览流（不录制） |
| `开始录制` | 启动摄像头并开始录制视频+音频 |
| `停止录制` | 停止录制，保存视频，触发语音转写，发送邮件 |
| `录制状态` | 查看当前是否在录制中 |

## 视频编码

- 视频：H.265 (libx265)，CRF 28，实时压缩
- 音频：AAC 48kHz
- 文件名：`{date}_{time}.mp4`

## 数据库

```sql
CREATE TABLE IF NOT EXISTS video_records (
  id              BIGSERIAL PRIMARY KEY,
  filename        TEXT NOT NULL,
  filepath        TEXT NOT NULL,
  duration_sec    INTEGER,
  resolution      TEXT,
  file_size_bytes BIGINT,
  transcript      TEXT,
  transcript_status TEXT DEFAULT 'pending',
  email_sent      BOOLEAN DEFAULT false,
  email_sent_at   TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

## 自动停止逻辑

3分钟画面静止（帧差 < 阈值）→ 自动停止录制 → 转写 → 发邮件

## 风险控制

- 录制前检查磁盘空间（< 1GB 告警）
- 端口热插拔检测，启动失败自动重检
- Whisper 转写异步执行，不阻塞主流程
- 数据库操作与记忆系统完全隔离（独立 video_records 表）
