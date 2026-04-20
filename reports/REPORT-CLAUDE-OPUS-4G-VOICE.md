# 4G 语音通讯系统 — 深度分析 & 完整重构方案

> **报告来源**：深度分析现有系统代码、配置、录音、日志
> **日期**：2026-04-14
> **状态**：待审批

---

## 一、系统深度盘点

### 1.1 硬件 & 物理连接

| 组件 | 实际状态 |
|------|---------|
| 模块 | SIMCOM A7670G VoLTE |
| AT 命令口 | `/dev/serial/by-id/usb-SIMCom_Wireless_Solution_A76XX_Series_LTE_Module_200806006809080000-if02-port0` → `/dev/ttyUSB1` |
| 短信口 | `/dev/ttyUSB2` (if04) |
| 备用口 | `/dev/ttyUSB3` (if05) |
| 音频录制 | `card 1: Generic_1 [HD-Audio Generic], device 0: ALC245 Analog` (plughw:1,0) |
| 音频输出 | `alsa_output.pci-0000_f4_00.1.hdmi-stereo` (HDMI) |
| 音频服务 | PipeWire（非 PulseAudio）|
| 录音格式 | PCM 16bit, 8kHz, Mono |

### 1.2 现有代码结构审查

```
/home/ai/.openclaw/workspace/voice-system/
├── src/
│   ├── voice_call_handler.py      # 主处理管线（硬编码DeepSeek key）
│   └── push_call_summary.py       # 独立推送脚本（又一份DeepSeek key）
├── recordings/inbound/            # 23条录音，28KB~1.3MB不等
├── data/
│   ├── calls.jsonl                # 23条JSONL记录
│   └── greeting_4g.wav            # 5.4s 提示音（48kHz stereo）
├── PLAN-COMBINED-FINAL.md         # 综合方案（9节）
├── PLAN-FINAL-v3.md               # v3方案（11节，SQLite方案）
├── ecosystem.4g.yaml              # PM2 单进程配置
└── start-4g.sh                    # 启动脚本

/home/ai/.openclaw/workspace/scripts/
├── 4g-combined-listener.py        # 核心监听器（v7，270行，单进程）
├── 4g-sms-listener.py             # 独立短信监听（PDU解码）
├── 4g-sms-decode.py               # PDU解码工具
├── 4g-call                         # 拨号CLI
├── 4g-answer                       # 接听CLI
└── 4g-sms                          # 短信CLI（仅text模式）
```

### 1.3 已验证能力矩阵

| # | 能力 | 状态 | 代码 | 质量 |
|---|------|------|------|------|
| 1 | AT 拨号/接听/挂断 | ✅ 稳定 | 4g-call, 4g-answer | 可用 |
| 2 | 来电监听+自动接听 | ✅ v7 | 4g-combined-listener.py | 可用 |
| 3 | 短信PDU解码（中文） | ✅ | 4g-sms-listener.py | 可用 |
| 4 | by-id 端口发现 | ✅ | find_at_port() | 稳定 |
| 5 | 硬件环回录音 | ✅ 23条 | arecord -D plughw:1,0 | ⚠️ 质量问题 |
| 6 | FunASR 转写 | ✅ 主力 | dashscope API | 依赖外部上传 |
| 7 | Whisper 兜底 | ✅ | whisper.load_model('large-v3-turbo') | 本地，GPU |
| 8 | LLM 摘要 | ✅ | DeepSeek Qwen-max | ⚠️ key硬编码 |
| 9 | 微信推送 | ✅ | openclaw message CLI | 可用 |
| 10 | Edge-TTS | ⚠️ CLI | edge-tts 7.2.8 | 未集成 |
| 11 | 提示音异步播放 | ✅ | ffmpeg → ALSA | 可用 |
| 12 | 启动残留检查 | ✅ | AT+CLCC | 可用 |

### 1.4 明确不可用的能力（已验证）

| 能力 | 原因 | 验证方式 |
|------|------|---------|
| SIP/RTP 录音 | A7670G VoLTE 不走 SIP | 模块规格确认 |
| AT+CCMXPLAY TTS | 文件无法上传模块 | 多次测试确认 |
| 中文短信发送 | 固件PDU编码bug | 4g-sms脚本实测 |
| AT+CREC 录音提取 | 文件不可导出 | 模块规格确认 |

### 1.5 实测录音质量问题

以 `20260413_093633_18180805797.wav` 为例：
- **平均音量**：-12.6 dB（偏高）
- **最大音量**：0.0 dB（**满幅clipping**）
- **0dB采样数**：3702 个（严重clipping）
- **持续时间显示异常**：soxi 显示 37:16:57（WAV header 损坏或未完成）
- **转写质量**：多记录显示"(转写失败)"或"(转写无结果)"

### 1.6 数据库环境

| 项目 | 状态 |
|------|------|
| PostgreSQL | Docker `pgvector/pgvector:pg16` on port 5432 |
| 数据库 | `openclaw_memory` |
| 用户 | `openclaw_ai` |
| 扩展 | plpgsql, vector, pg_trgm |
| 现有表 | 40+ 表（无 voice/call/contact 相关表）|
| 方案选择 | **PostgreSQL**（任务要求），非 v3 方案的 SQLite |

---

## 二、系统架构设计

### 2.1 完整架构图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          4G 语音通讯系统 v2.0                              │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  进程1：voice-listener（AT 监听器，PM2 守护）                        │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  pyserial ─→ /dev/ttyUSB1 (115200)                           │  │  │
│  │  │  ↓ URC 事件解析                                              │  │  │
│  │  │  ├── RING → 触发来电流程                                     │  │  │
│  │  │  ├── +CLIP:"13980819087" → 查通讯录 → 获取身份              │  │  │
│  │  │  ├── NO CARRIER → 通话结束事件                               │  │  │
│  │  │  └── +CMT → 短信事件                                        │  │  │
│  │  │                                                              │  │  │
│  │  │  来电处理流程：                                               │  │  │
│  │  │  来电 → 通讯录匹配 → 策略判定 → ATA/AT+CHUP → 启动录音       │  │  │
│  │  │  → 播放提示音 → 等待通话结束 → 写事件文件 → 返回监听         │  │  │
│  │  │                                                              │  │  │
│  │  │  ⏱️  毫秒级响应，不阻塞                                       │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────┬─────────────────────────────────────────┘  │
│                             │ 文件系统事件队列                            │
│                             │ /tmp/voice-events/*.json                   │
│                             ▼                                            │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  进程2：voice-processor（后处理器，PM2 守护）                        │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │  监控事件目录（inotify 轮询）                                  │  │  │
│  │  │  ↓                                                           │  │  │
│  │  │  FunASR 转写 → Whisper 兜底                                   │  │  │
│  │  │  ↓                                                           │  │  │
│  │  │  LLM 摘要生成                                                 │  │  │
│  │  │  ↓                                                           │  │  │
│  │  │  写入 PostgreSQL（calls / contacts 表）                       │  │  │
│  │  │  ↓                                                           │  │  │
│  │  │  微信推送（openclaw message）                                  │  │  │
│  │  │  ↓                                                           │  │  │
│  │  │  更新联系人 last_call_at + call_count                         │  │  │
│  │  │                                                              │  │  │
│  │  │  ⏱️  异步处理，20-60秒耗时不影响监听                            │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  PostgreSQL（Docker pg16:5432）                                     │  │
│  │  openclaw_memory 数据库                                             │  │
│  │  ┌──────────┐ ┌──────┐ ┌──────┐ ┌──────────┐ ┌──────────────┐    │  │
│  │  │ contacts │ │ calls│ │ sms  │ │unknown_  │ │ system_log   │    │  │
│  │  │          │ │      │ │      │ │callers   │ │              │    │  │
│  │  └──────────┘ └──────┘ └──────┘ └──────────┘ └──────────────┘    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ voice-cli.py    │  │ Edge-TTS     │  │ 微信推送 (openclaw msg) │   │
│  │ (通讯录/通话    │  │ (TTS外呼)    │  │                          │   │
│  │  管理CLI)      │  │              │  │                          │   │
│  └─────────────────┘  └──────────────┘  └──────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

外部依赖：
  FunASR  ──→ dashscope API ──→ catbox.moe 上传
  Whisper   ──→ 本地 GPU (AMD Radeon 8060S, 16GB VRAM)
  LLM 摘要  ──→ DeepSeek Qwen-max
  TTS      ──→ edge-tts CLI
```

### 2.2 核心模块职责

| 模块 | 职责 | 实时性要求 | 阻塞容忍 |
|------|------|-----------|---------|
| voice-listener | AT 串口监听、通话控制、录音、事件写入 | 毫秒级 | 不可阻塞 |
| voice-processor | ASR转写、LLM摘要、推送、入库 | 无 | 完全容忍 |
| contacts | 通讯录 CRUD、来电匹配、策略查询 | 查询<50ms | N/A |
| voice-cli | 用户命令行管理 | N/A | N/A |

### 2.3 数据流设计

```
来电数据流：
  串口RING → +CLIP号码 → contacts查询 → 策略决策 → ATA接听
  → arecord录音 → VOICE CALL: END → stop_recording
  → 写 /tmp/voice-events/{uuid}.json → 返回监听循环
  → voice-processor 异步消费 → FunASR/Whisper → LLM → DB → 微信

外呼数据流：
  voice-cli "给XX打电话" → contacts查询号码 → ATD拨号
  → 检测VOIC CALL:BEGIN → 播放TTS(反向环回) → 录音 → 挂断
  → 写事件文件 → 后处理（同来电）

短信数据流：
  串口+CMT → PDU解码 → contacts匹配发件人
  → 写 /tmp/voice-events/sms_{uuid}.json
  → voice-processor 消费 → DB → 微信推送
```

---

## 三、通讯录模块（最高优先级）

### 3.1 PostgreSQL Schema 设计

```sql
-- ============================================
-- contacts 表 — 通讯录主表
-- ============================================
CREATE TABLE IF NOT EXISTS contacts (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR(100) NOT NULL,              -- 姓名/称呼
    phone             VARCHAR(20) UNIQUE NOT NULL,        -- 原始手机号
    phone_normalized  VARCHAR(20) NOT NULL,               -- 标准化号码（去+86/空格/-）
    relationship      VARCHAR(20),                         -- 家人/同事/朋友/快递/客服/其他
    importance        SMALLINT DEFAULT 0,                 -- 0=普通 1=重要 2=紧急
    is_blacklist      BOOLEAN DEFAULT FALSE,               -- 黑名单
    is_whitelist      BOOLEAN DEFAULT FALSE,              -- 白名单（跳过振铃直接接听）
    last_call_at      TIMESTAMPTZ,                        -- 最后通话时间
    call_count        INTEGER DEFAULT 0,                  -- 累计通话次数
    notes             TEXT,                               -- 备注
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE UNIQUE INDEX idx_contacts_phone_norm ON contacts(phone_normalized);
CREATE INDEX idx_contacts_blacklist ON contacts(is_blacklist) WHERE is_blacklist = TRUE;
CREATE INDEX idx_contacts_whitelist ON contacts(is_whitelist) WHERE is_whitelist = TRUE;
CREATE INDEX idx_contacts_importance ON contacts(importance) WHERE importance >= 1;
-- pg_trgm 模糊搜索（支持姓名/号码部分匹配）
CREATE INDEX idx_contacts_name_trgm ON contacts USING gin (name gin_trgm_ops);
CREATE INDEX idx_contacts_phone_trgm ON contacts USING gin (phone gin_trgm_ops);

-- ============================================
-- calls 表 — 通话记录
-- ============================================
CREATE TABLE IF NOT EXISTS calls (
    id                BIGSERIAL PRIMARY KEY,
    contact_id        INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    phone             VARCHAR(20),                       -- 号码（未匹配时为裸号）
    direction         VARCHAR(10) NOT NULL,              -- inbound / outbound
    status            VARCHAR(20) NOT NULL,              -- answered / missed / rejected / voicemail
    duration          INTEGER DEFAULT 0,                 -- 通话秒数
    recording_path    TEXT,                              -- 录音文件路径
    transcript        TEXT,                              -- ASR 转写文本
    summary           TEXT,                              -- LLM 摘要
    tags              JSONB,                             -- 标签数组 ["重要","待跟进"]
    recording_quality JSONB,                             -- 录音质量 {mean_db: -12.6, max_db: 0.0, clipped: true}
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_calls_contact ON calls(contact_id);
CREATE INDEX idx_calls_created ON calls(created_at DESC);
CREATE INDEX idx_calls_phone ON calls(phone);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_direction ON calls(direction);
-- 复合索引：按联系人+时间查询
CREATE INDEX idx_calls_contact_time ON calls(contact_id, created_at DESC);

-- ============================================
-- sms 表 — 短信记录
-- ============================================
CREATE TABLE IF NOT EXISTS sms (
    id                BIGSERIAL PRIMARY KEY,
    contact_id        INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    phone             VARCHAR(20) NOT NULL,              -- 发件人/收件人
    direction         VARCHAR(10) NOT NULL,              -- inbound / outbound
    content           TEXT,                              -- 短信内容
    encoding          VARCHAR(20),                       -- UCS-2 / 7-bit GSM
    smsc              VARCHAR(30),                       -- 短信中心号码
    status            VARCHAR(20) DEFAULT 'received',    -- received / sent / failed
    timestamp         TIMESTAMPTZ,                       -- 短信时间戳
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sms_contact ON sms(contact_id);
CREATE INDEX idx_sms_created ON sms(created_at DESC);
CREATE INDEX idx_sms_phone ON sms(phone);

-- ============================================
-- unknown_callers 表 — 未知号码自动学习
-- ============================================
CREATE TABLE IF NOT EXISTS unknown_callers (
    id                BIGSERIAL PRIMARY KEY,
    phone             VARCHAR(20) UNIQUE NOT NULL,
    phone_normalized  VARCHAR(20) NOT NULL,
    first_seen        TIMESTAMPTZ DEFAULT NOW(),
    last_seen         TIMESTAMPTZ,
    call_count        INTEGER DEFAULT 1,
    sms_count         INTEGER DEFAULT 0,
    labeled           BOOLEAN DEFAULT FALSE,              -- 是否已被用户标注
    label_suggested   BOOLEAN DEFAULT FALSE,              -- 是否已建议添加
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_unknown_callers_normalized ON unknown_callers(phone_normalized);
CREATE INDEX idx_unknown_callers_unlabeled ON unknown_callers(labeled, label_suggested);

-- ============================================
-- system_log 表 — 系统运行日志
-- ============================================
CREATE TABLE IF NOT EXISTS system_log (
    id                BIGSERIAL PRIMARY KEY,
    level             VARCHAR(10) NOT NULL,               -- info / warn / error / critical
    module            VARCHAR(30),                        -- listener / processor / contacts / tts
    message           TEXT NOT NULL,
    detail            JSONB,                              -- 额外上下文
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_system_log_created ON system_log(created_at DESC);
CREATE INDEX idx_system_log_level ON system_log(level);
```

### 3.2 CRUD API 设计

```python
# voice-system/src/contacts_db.py
"""PostgreSQL 通讯录数据库操作"""
import asyncpg  # 或 psycopg2
from datetime import datetime

class ContactsDB:
    def __init__(self, dsn="postgresql://openclaw_ai:password@localhost:5432/openclaw_memory"):
        self.dsn = dsn

    async def init_pool(self):
        self.pool = await asyncpg.create_pool(self.dsn, min_size=2, max_size=5)

    # ── 号码标准化 ──
    @staticmethod
    def normalize_phone(phone: str) -> str:
        """去 +86、去空格/横线/括号、去长途前缀0"""
        import re
        p = re.sub(r'[\s\-\(\)]+', '', phone)
        if p.startswith('+86'):
            p = p[3:]
        if p.startswith('86') and len(p) == 13:
            p = p[2:]
        if p.startswith('0') and len(p) > 10:
            p = p[1:]
        return p

    # ── 来电识别 ──
    async def lookup(self, phone: str) -> dict | None:
        """来电号码匹配通讯录，返回联系人信息"""
        norm = self.normalize_phone(phone)
        async with self.pool.acquire() as conn:
            # 精确匹配
            row = await conn.fetchrow(
                "SELECT id, name, phone, relationship, importance, is_blacklist, is_whitelist "
                "FROM contacts WHERE phone_normalized = $1",
                norm
            )
            if row:
                return dict(row)

            # 后7位模糊匹配（防止区号差异）
            if len(norm) >= 7:
                suffix = norm[-7:]
                row = await conn.fetchrow(
                    "SELECT id, name, phone, relationship, importance, is_blacklist, is_whitelist "
                    "FROM contacts WHERE RIGHT(phone_normalized, 7) = $1",
                    suffix
                )
                if row:
                    return dict(row)
            return None

    # ── 添加联系人 ──
    async def add(self, name: str, phone: str, relationship: str = None,
                  importance: int = 0, is_blacklist: bool = False,
                  is_whitelist: bool = False, notes: str = None) -> int:
        norm = self.normalize_phone(phone)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "INSERT INTO contacts (name, phone, phone_normalized, relationship, "
                "importance, is_blacklist, is_whitelist, notes) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) "
                "ON CONFLICT (phone_normalized) DO UPDATE SET "
                "name = EXCLUDED.name, relationship = EXCLUDED.relationship, "
                "importance = EXCLUDED.importance, updated_at = NOW() "
                "RETURNING id",
                name, phone, norm, relationship, importance, is_blacklist, is_whitelist, notes
            )
            return row['id']

    # ── 搜索 ──
    async def search(self, query: str) -> list[dict]:
        """姓名/号码模糊搜索（pg_trgm）"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, name, phone, relationship, importance, is_blacklist, is_whitelist "
                "FROM contacts WHERE name % $1 OR phone % $1 "
                "ORDER BY similarity(name, $1) + similarity(phone, $1) DESC LIMIT 20",
                query
            )
            return [dict(r) for r in rows]

    # ── 通话后更新联系人 ──
    async def record_call(self, phone: str):
        """通话结束后更新联系人统计"""
        norm = self.normalize_phone(phone)
        async with self.pool.acquire() as conn:
            await conn.execute(
                "UPDATE contacts SET last_call_at = NOW(), call_count = call_count + 1, "
                "updated_at = NOW() WHERE phone_normalized = $1",
                norm
            )

    # ── 黑名单查询 ──
    async def is_blacklisted(self, phone: str) -> bool:
        norm = self.normalize_phone(phone)
        async with self.pool.acquire() as conn:
            row = await conn.fetchval(
                "SELECT is_blacklist FROM contacts WHERE phone_normalized = $1",
                norm
            )
            return bool(row)

    # ── 白名单查询 ──
    async def is_whitelisted(self, phone: str) -> bool:
        norm = self.normalize_phone(phone)
        async with self.pool.acquire() as conn:
            row = await conn.fetchval(
                "SELECT is_whitelist FROM contacts WHERE phone_normalized = $1",
                norm
            )
            return bool(row)

    # ── 未知号码 ──
    async def record_unknown(self, phone: str, call_type: str = 'call'):
        """记录未知号码来电/短信"""
        norm = self.normalize_phone(phone)
        async with self.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO unknown_callers (phone, phone_normalized, last_seen, call_count, sms_count) "
                "VALUES ($1, $2, NOW(), 1, 0) "
                "ON CONFLICT (phone_normalized) DO UPDATE SET "
                "last_seen = NOW(), "
                f"{'call_count = unknown_callers.call_count + 1' if call_type == 'call' else 'sms_count = unknown_callers.sms_count + 1'}",
                phone, norm
            )

    # ── 未知号码建议推送 ──
    async def check_unknown_suggestions(self) -> list[dict]:
        """找出 call_count >= 3 且未建议的未知号码"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT phone, call_count, first_seen, last_seen "
                "FROM unknown_callers WHERE call_count >= 3 AND label_suggested = FALSE "
                "ORDER BY call_count DESC, last_seen DESC"
            )
            for r in rows:
                await conn.execute(
                    "UPDATE unknown_callers SET label_suggested = TRUE WHERE phone_normalized = $1",
                    self.normalize_phone(r['phone'])
                )
            return [dict(r) for r in rows]
```

### 3.3 来电识别流程

```
来电 +CLIP:"13980819087"
  │
  ├─→ normalize_phone("13980819087") → "13980819087"
  │
  ├─→ contacts.lookup("13980819087")
  │   ├─ 精确匹配 phone_normalized = "13980819087" → ✅ 找到
  │   ├─ 未命中 → RIGHT(phone_normalized, 7) = "80819087" → 模糊匹配
  │   └─ 仍未命中 → 返回 None
  │
  ├─ 匹配到 → {name: "老妈", importance: 2, is_whitelist: True, ...}
  │   ├─ is_blacklist == True → 策略: AT+CHUP 自动挂断
  │   ├─ is_whitelist == True → 策略: 跳过振铃，立即 ATA
  │   ├─ importance >= 2 → 推送标记"🔴紧急"
  │   └─ importance == 0 → 策略: 2次振铃后 ATA（默认）
  │
  └─ 未匹配 → 记录到 unknown_callers 表
      ├─ call_count += 1
      └─ call_count >= 3 且未建议 → 推送"📱 未知号码 13980819087 已来电3次，建议添加通讯录"
```

### 3.4 未知号码自动学习机制

```python
# 在 voice-listener 中，未匹配到通讯录时调用
async def handle_unknown_caller(self, phone: str):
    """未知号码处理"""
    contact = await self.contacts_db.lookup(phone)
    if contact is None:
        await self.contacts_db.record_unknown(phone, 'call')

        # 检查是否需要推送建议
        suggestions = await self.contacts_db.check_unknown_suggestions()
        for sug in suggestions:
            # 通过 voice-processor 异步推送，不阻塞监听
            await self.event_queue.push({
                "event": "unknown_suggestion",
                "phone": sug['phone'],
                "call_count": sug['call_count'],
                "first_seen": str(sug['first_seen'])
            })
```

---

## 四、通话管理模块

### 4.1 来电监听 + 策略执行

```python
# voice-system/src/voice_listener.py
"""精简版 AT 监听器 — 只负责串口事件 + 录音 + 事件写入"""

import serial, time, re, os, json, uuid, asyncio
from datetime import datetime

class VoiceListener:
    def __init__(self):
        self.port = self.find_at_port()
        self.ser = None
        self.in_call = False
        self.call_start = None
        self.caller = None
        self.rec_path = None
        self.ring_count = 0
        self.ringing = False
        self.audio_device = self.find_audio_device()
        self.event_dir = '/tmp/voice-events'
        os.makedirs(self.event_dir, exist_ok=True)

        # 初始化通讯录
        from contacts_db import ContactsDB
        self.contacts = ContactsDB()
        asyncio.run(self.contacts.init_pool())

    async def handle_incoming_call(self, phone: str):
        """来电处理主流程"""
        # 1. 通讯录匹配
        contact = await self.contacts.lookup(phone)

        # 2. 策略判定
        if contact:
            if contact['is_blacklist']:
                log(f"🚫 黑名单: {phone} ({contact['name']})，自动挂断")
                await self.hangup()
                await self.write_event({
                    "event": "call_rejected",
                    "phone": phone, "contact_name": contact['name'],
                    "reason": "blacklist", "timestamp": datetime.now().isoformat()
                })
                return

            if contact['is_whitelist']:
                log(f"⭐ 白名单: {phone} ({contact['name']})，跳过振铃直接接听")
                await self.answer(phone, contact)
                return

        # 3. 默认策略：2次振铃后接听
        if self.ring_count >= 2:
            await self.answer(phone, contact)

    async def answer(self, phone: str, contact: dict | None):
        """接听来电"""
        self.ser.write(b'ATA\r\n')
        time.sleep(0.3)

        # 等待通话建立
        answered = await self.wait_for_call_begin(timeout=4.0)
        if not answered:
            log(f"[ATA] ❌ 接听失败")
            return

        # 开始录音
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        safe = re.sub(r'\D', '', phone)[-11:] if phone else 'unknown'
        self.rec_path = f'/home/ai/.openclaw/workspace/voice-system/recordings/inbound/{ts}_{safe}.wav'

        self.start_recording(self.rec_path)
        self.in_call = True
        self.call_start = datetime.now()
        self.caller = phone

        # 异步播放提示音
        self.play_greeting_async()

        contact_name = contact['name'] if contact else "未知号码"
        log(f"📞 已接听: {contact_name} ({phone})")

    async def write_event(self, event: dict):
        """写入事件文件，供 processor 消费"""
        event_id = str(uuid.uuid4())[:8]
        event_file = f"{self.event_dir}/{event_id}.json"
        with open(event_file, 'w') as f:
            json.dump(event, f, ensure_ascii=False, indent=2)
        log(f"[事件] 写入: {event_file}")

    async def handle_call_end(self):
        """通话结束处理"""
        duration = (datetime.now() - self.call_start).seconds if self.call_start else 0
        log(f"📞 通话结束: {self.caller}，{duration}s")

        self.stop_recording()

        contact = await self.contacts.lookup(self.caller)
        contact_name = contact['name'] if contact else None

        # 写入事件
        event = {
            "event": "call_ended",
            "phone": self.caller,
            "contact_name": contact_name,
            "direction": "inbound",
            "status": "answered",
            "duration": duration,
            "recording_path": self.rec_path,
            "timestamp": datetime.now().isoformat()
        }
        await self.write_event(event)

        # 更新联系人统计
        if contact:
            await self.contacts.record_call(self.caller)
        else:
            await self.contacts.record_unknown(self.caller, 'call')

        self.in_call = False
        self.caller = None
        self.rec_path = None
```

### 4.2 通话状态机

```
IDLE ──RING──→ RINGING ──ATA──→ CONNECTING ──VOICE CALL:BEGIN──→ IN_CALL
  ↑                  │                │                              │
  │                  └──NO CARRIER──→ MISSED                        │
  │                                                              │
  └──NO CARRIER / VOICE CALL:END / AT+CHUP ←──────────────────────┘

状态说明：
  IDLE:       空闲，等待来电
  RINGING:    收到 RING + CLIP，等待振铃次数达标
  CONNECTING: ATA 已发送，等待模块确认
  IN_CALL:    通话进行中，录音中
  MISSED:     振铃期间对方挂断
```

### 4.3 录音方案

```bash
# 当前方案（有问题）：
arecord -D plughw:1,0 -f S16_LE -r 8000 -c 1 output.wav

# 修复方案（增益控制 + 格式）：
arecord -D plughw:1,0 -f S16_LE -r 16000 -c 1 -v 0.3 output.wav
#  -r 16000: 与 FunASR 要求一致，避免二次转码
#  -v 0.3:   降低增益到 30%，防止 clipping
#  -f S16_LE: 16bit PCM

# 录音后处理（自动检测 + 标准化）：
ffmpeg -i input.wav -af "volumedetect" -f null /dev/null 2>&1 | grep max_volume
# 如果 max_volume > -1dB → 标记为"可能失真"

# 标准化到 -3dB 峰值：
ffmpeg -i input.wav -af "loudnorm=I=-16:TP=-3:LRA=11" -ar 16000 output_normalized.wav
```

### 4.4 双向录音方案（pactl loopback）

```bash
# 方案A：PulseAudio/PipeWire loopback 模块
# 1. 加载 loopback 模块（将模块音频输出回送到录音输入）
pactl load-module module-loopback source=alsa_output.pci-0000_f4_00.1.hdmi-stereo.monitor sink=alsa_input.pci-0000_f4_00.6.analog-stereo

# 2. 录制混合音频（包含系统播放的对方声音 + 麦克风）
parecord -d alsa_input.pci-0000_f4_00.6.analog-stereo \
  --format=s16le --rate=16000 --channels=2 \
  /tmp/call_dual.wav

# 3. 后期用 sox 合并双声道为单声道
sox /tmp/call_dual.wav -c 1 /tmp/call_merged.wav remix 1,2

# ⚠️ 注意：A7670G 的 VoLTE 音频走模块内部 IMS，不经过 Linux ALSA
# 所以即使 loopback 也无法捕获对方声音到 Linux 录音
# 当前唯一可行方案：硬件环回（Line-In 接模块 Audio OUT）
# 只能录到对方声音，自己的声音无法录制
# Voice Call AI 需要双向音频 → 这是根本限制，需接受

# 替代方案：自己说话通过 TTS 播放时，可用 loopback 捕获 TTS 音频
# 但这只适用于外呼 TTS 场景，不适用于通话中自己说话
### 4.5 外呼管理

```python
# voice-system/src/outbound_call.py
"""外呼管理模块"""
import serial, time, re

class OutboundCall:
    def __init__(self, port: str = '/dev/ttyUSB1'):
        self.port = port
        self.ser = None

    def dial(self, phone: str, timeout: int = 120) -> dict:
        """拨打电话，返回通话结果"""
        self.ser = serial.Serial(self.port, 115200, timeout=1)
        self.ser.flushInput()

        # 发送 ATD
        self.ser.write(f'ATD{phone};\r\n'.encode())
        time.sleep(3)

        # 等待通话建立
        buf = ''
        connected = False
        for _ in range(timeout * 10):
            if self.ser.in_waiting:
                chunk = self.ser.read(self.ser.in_waiting).decode(errors='replace')
                buf += chunk
                if 'VOICE CALL: BEGIN' in buf:
                    connected = True
                    break
                if 'NO CARRIER' in buf:
                    break
            time.sleep(0.1)

        result = {"phone": phone, "connected": connected, "duration": 0}
        if connected:
            start = time.time()
            # 等待通话结束或超时
            while time.time() - start < timeout:
                if self.ser.in_waiting:
                    chunk = self.ser.read(self.ser.in_waiting).decode(errors='replace')
                    if 'NO CARRIER' in chunk or 'VOICE CALL: END' in chunk:
                        result["duration"] = int(time.time() - start)
                        break
                time.sleep(0.1)

        self.ser.write(b'AT+CHUP\r\n')
        time.sleep(1)
        self.ser.close()
        return result
```

---

## 五、短信模块

### 5.1 接收 + 解码（已有，保持现状）

现有 `4g-sms-listener.py` 和 `4g-sms-decode.py` 工作正常，PDU 解码支持中文。只需：
1. 将短信结果写入 PostgreSQL `sms` 表
2. 发件人号码匹配通讯录

### 5.2 发送方案（解决中文 PDU 编码问题）

```python
# voice-system/src/sms_sender.py
"""短信发送 — 绕过固件 bug 的方案"""

class SMSSender:
    def send_text_mode(self, phone: str, message: str, port: str = '/dev/ttyUSB2') -> bool:
        """
        方案1：尝试 Text 模式（AT+CMGF=1）
        部分固件在 Text 模式下中文编码正常
        """
        import serial, time
        ser = serial.Serial(port, 115200, timeout=5)
        ser.flushInput()
        time.sleep(1)

        # 设置 Text 模式
        ser.write(b'AT+CMGF=1\r\n')
        time.sleep(1)
        resp = ser.read(ser.in_waiting).decode()
        if 'OK' not in resp:
            ser.close()
            return self.send_pdu_mode(phone, message, port)  # 回退到 PDU

        # 设置 UCS2 编码（支持中文）
        ser.write(b'AT+CSCS="UCS2"\r\n')
        time.sleep(1)
        resp = ser.read(ser.in_waiting).decode()

        # 发送
        ser.write(f'AT+CMGS="{phone}"\r\n'.encode())
        time.sleep(2)
        resp = ser.read(ser.in_waiting).decode()

        if '>' in resp:
            # 将中文转为 UCS2 编码
            ucs2_msg = message.encode('utf-16-be').hex().upper()
            ser.write(ucs2_msg.encode())
            time.sleep(0.3)
            ser.write(bytes([0x1A]))  # Ctrl+Z
            time.sleep(10)
            result = ser.read(ser.in_waiting).decode()
            ser.close()
            return '+CMGS:' in result

        ser.close()
        return False

    def send_pdu_mode(self, phone: str, message: str, port: str = '/dev/ttyUSB2') -> bool:
        """
        方案2：手动构造正确 PDU（绕过固件 bug）
        如果固件的 PDU 编码有 bug，我们在主机侧构造正确的 PDU
        """
        import serial, time

        # 构造 UCS2 PDU
        pdu = self.build_pdu_ucs2(phone, message)
        if pdu is None:
            return False

        ser = serial.Serial(port, 115200, timeout=5)
        ser.flushInput()
        time.sleep(1)

        ser.write(b'AT+CMGF=0\r\n')  # PDU 模式
        time.sleep(1)
        ser.read(ser.in_waiting)

        # 发送 PDU 长度 + PDU 数据
        pdu_len = len(pdu) // 2  # PDU 字节数（不含 SMSC 长度字节）
        ser.write(f'AT+CMGS={pdu_len}\r\n'.encode())
        time.sleep(1)
        resp = ser.read(ser.in_waiting).decode()

        if '>' in resp:
            ser.write(pdu.encode())
            time.sleep(0.3)
            ser.write(bytes([0x1A]))
            time.sleep(10)
            result = ser.read(ser.in_waiting).decode()
            ser.close()
            return '+CMGS:' in result

        ser.close()
        return False

    def build_pdu_ucs2(self, phone: str, message: str) -> str:
        """构造 UCS2 编码的 PDU 短信"""
        # SMSC（使用默认）
        smsc = '00'

        # 第一八位位组：SMS-SUBMIT (0x11)
        first_octet = '11'

        # 消息参考号
        mr = '00'

        # 目标地址
        addr = self.encode_address(phone)

        # 协议标识符
        pid = '00'

        # 数据编码方案：UCS2 (0x08)
        dcs = '08'

        # 有效期
        vp = 'AA'

        # 用户数据（UCS2 编码）
        ud = message.encode('utf-16-be').hex().upper()
        udl = len(message)  # UCS2 模式下 UDL 是字符数

        # 组装 PDU
        pdu = smsc + first_octet + mr + addr + pid + dcs + vp + format(udl, '02X') + ud
        return pdu

    @staticmethod
    def encode_address(phone: str) -> str:
        """编码目标地址（半八位位组格式）"""
        # 去 + 号
        if phone.startswith('+'):
            phone = phone[1:]

        # 长度
        addr_len = len(phone)

        # 类型：国际号码 (0x91)
        ton_npi = '91'

        # 号码交换 nibbles
        digits = ''
        for i in range(0, len(phone), 2):
            if i + 1 < len(phone):
                digits += phone[i+1] + phone[i]
            else:
                digits += 'F' + phone[i]

        return format(addr_len, '02X') + ton_npi + digits
```

### 5.3 短信与通讯录集成

```python
# 在 voice-listener 中处理短信时：
async def handle_sms(self, sender: str, content: str, timestamp: str):
    contact = await self.contacts.lookup(sender)
    contact_name = contact['name'] if contact else sender

    # 写入数据库
    async with self.pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO sms (contact_id, phone, direction, content, encoding, timestamp) "
            "VALUES ($1, $2, 'inbound', $3, 'UCS-2', $4)",
            contact['id'] if contact else None, sender, content, timestamp
        )

    # 推送微信
    await self.push_sms(contact_name, sender, content)
```

---

## 六、AI 语音管线

### 6.1 录音 → Whisper 转写 → LLM 摘要 → 推送（现有管线优化）

```python
# voice-system/src/voice_processor.py
"""后处理器 — 异步消费事件文件"""
import os, json, glob, asyncio, subprocess
from datetime import datetime
from contacts_db import ContactsDB
from transcriber import Transcriber
from summarizer import Summarizer
from notifier import Notifier

class VoiceProcessor:
    def __init__(self):
        self.event_dir = '/tmp/voice-events'
        self.processed_dir = f'{self.event_dir}/processed'
        os.makedirs(self.processed_dir, exist_ok=True)

        self.contacts = ContactsDB()
        self.transcriber = Transcriber()
        self.summarizer = Summarizer()
        self.notifier = Notifier()

    async def run(self):
        """主循环：轮询事件目录"""
        while True:
            events = glob.glob(f'{self.event_dir}/*.json')
            for event_file in sorted(events):
                if '/processed/' in event_file:
                    continue
                try:
                    await self.process_event(event_file)
                    os.rename(event_file, f'{self.processed_dir}/{os.path.basename(event_file)}')
                except Exception as e:
                    print(f"[Processor] 处理失败 {event_file}: {e}")
            await asyncio.sleep(1)  # 轮询间隔 1 秒

    async def process_event(self, event_file: str):
        """处理单个事件"""
        with open(event_file) as f:
            event = json.load(f)

        etype = event.get('event')

        if etype == 'call_ended':
            await self.handle_call_ended(event)
        elif etype == 'sms_received':
            await self.handle_sms_event(event)
        elif etype == 'unknown_suggestion':
            await self.handle_unknown_suggestion(event)

    async def handle_call_ended(self, event: dict):
        """通话结束处理管线"""
        rec_path = event.get('recording_path')
        phone = event.get('phone')
        duration = event.get('duration', 0)
        contact_name = event.get('contact_name', '未知号码')

        # 1. 录音质量检测
        quality = await self.check_recording_quality(rec_path)

        # 2. ASR 转写（FunASR 优先 → Whisper 兜底）
        transcript = await self.transcriber.transcribe(rec_path)

        # 3. LLM 摘要
        summary = await self.summarizer.summarize(transcript, contact_name, duration)

        # 4. 写入 PostgreSQL
        await self.save_call_record(event, transcript, summary, quality)

        # 5. 微信推送
        await self.notifier.push_call_summary(contact_name, phone, duration, summary, transcript, rec_path)

    async def check_recording_quality(self, wav_path: str) -> dict:
        """检测录音质量"""
        try:
            result = subprocess.run(
                ['ffmpeg', '-i', wav_path, '-af', 'volumedetect', '-f', 'null', '/dev/null'],
                capture_output=True, text=True, timeout=10
            )
            stderr = result.stderr
            mean_vol = None
            max_vol = None
            for line in stderr.splitlines():
                if 'mean_volume' in line:
                    mean_vol = float(line.split(': ')[-1].replace(' dB', ''))
                if 'max_volume' in line:
                    max_vol = float(line.split(': ')[-1].replace(' dB', ''))

            return {
                "mean_db": mean_vol,
                "max_db": max_vol,
                "clipped": max_vol is not None and max_vol >= -1.0,
                "checked_at": datetime.now().isoformat()
            }
        except Exception as e:
            return {"error": str(e)}
```

### 6.2 Voice Call AI 实时对话方案

**现实评估**：由于 A7670G VoLTE 音频不经过 Linux ALSA，实时语音对话存在根本限制。

**可行方案（分阶段）**：

| 阶段 | 能力 | 可行性 | 说明 |
|------|------|--------|------|
| S1 | 来电自动播放提示音 | ✅ 已有 | greeting_4g.wav |
| S2 | 来电转写 → LLM → TTS 播放给对方 | ⚠️ 受限 | 需要反向硬件环回 |
| S3 | 实时双向对话 | ❌ 不可行 | 无法捕获自己声音 |

**S2 方案详细设计**：

```python
# voice-system/src/voice_call_ai.py
"""Voice Call AI — 来电转写+AI回复+TTS播放"""

class VoiceCallAI:
    def __init__(self):
        self.transcriber = Transcriber()
        self.llm = LLMClient()
        self.tts = TTSClient()
        self.contacts = ContactsDB()

    async def handle_incoming_ai(self, phone: str, rec_path: str):
        """来电 → 录音 → 转写 → AI回复 → TTS播放（对方能听到）"""
        # 1. 转写对方说话
        transcript = await self.transcriber.transcribe(rec_path)

        # 2. 生成 AI 回复
        contact = await self.contacts.lookup(phone)
        reply = await self.llm.generate_reply(transcript, contact)

        # 3. TTS 生成音频
        tts_path = await self.tts.synthesize(reply, '/tmp/ai_reply.wav')

        # 4. 播放给对方听（反向硬件环回）
        # 主机 aplay → 3.5mm 音频线 → 模块 MIC 输入
        # ⚠️ 通话已开始，模块 MIC 输入会发送给对方
        # 但需要模块 MIC 引脚与 Audio OUT 物理连接
        if self.reverse_loopback_available():
            subprocess.run(['aplay', '-D', 'plughw:1,0', tts_path])

        return reply

    def reverse_loopback_available(self):
        """检测反向硬件环回是否已连接"""
        # 检查 3.5mm 音频线是否连接
        # 可通过检测 MIC 输入电平判断
        return False  # 需要硬件连接后才可用
```

### 6.3 TTS 外呼方案

```python
# voice-system/src/tts_client.py
"""Edge-TTS 封装"""
import subprocess, tempfile, os

class TTSClient:
    def __init__(self, voice: str = "zh-CN-YunxiNeural"):
        self.voice = voice  # 男声，自然
        # 备选: zh-CN-XiaoxiaoNeural (女声)
        #       zh-CN-YunyangNeural (男声，新闻播报风格)

    async def synthesize(self, text: str, output_path: str = None) -> str:
        """将文字转为语音"""
        if output_path is None:
            output_path = tempfile.mktemp(suffix='.wav')

        cmd = [
            'edge-tts',
            '--voice', self.voice,
            '--text', text,
            '--write-media', output_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise RuntimeError(f"Edge-TTS 失败: {result.stderr}")

        return output_path

    async def synthesize_and_play(self, text: str, device: str = 'plughw:1,0'):
        """TTS 生成并立即播放"""
        path = await self.synthesize(text)
        subprocess.run(['aplay', '-D', device, path])
        os.unlink(path)
```

---

## 七、数据库设计（完整）

### 7.1 数据库初始化脚本

```sql
-- voice-system/sql/init.sql
-- 执行: docker exec openclaw-postgres psql -U openclaw_ai -d openclaw_memory -f init.sql

-- 启用 pg_trgm（如果未启用）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 创建所有表（见第三节 Schema）
\i /home/ai/.openclaw/workspace/voice-system/sql/contacts.sql
\i /home/ai/.openclaw/workspace/voice-system/sql/calls.sql
\i /home/ai/.openclaw/workspace/voice-system/sql/sms.sql
\i /home/ai/.openclaw/workspace/voice-system/sql/unknown_callers.sql
\i /home/ai/.openclaw/workspace/voice-system/sql/system_log.sql

-- 创建初始数据
INSERT INTO contacts (name, phone, phone_normalized, relationship, importance, is_whitelist)
VALUES
    ('姚旭（灵须子）', '18180805797', '18180805797', '主人', 2, true),
    ('测试号码', '18180805696', '18180805696', '测试', 0, false),
    ('未知联系人A', '13980819087', '13980819087', '其他', 0, false),
    ('未知联系人B', '19180805647', '19180805647', '其他', 0, false)
ON CONFLICT (phone_normalized) DO NOTHING;
```

### 7.2 迁移现有 JSONL 数据

```python
# voice-system/scripts/migrate_jsonl_to_pg.py
"""将 calls.jsonl 迁移到 PostgreSQL"""
import json, asyncio
from contacts_db import ContactsDB

async def migrate():
    db = ContactsDB()
    await db.init_pool()

    calls = []
    with open('/home/ai/.openclaw/workspace/voice-system/data/calls.jsonl') as f:
        for line in f:
            calls.append(json.loads(line))

    print(f"找到 {len(calls)} 条通话记录")

    # 提取所有唯一号码
    phones = set()
    for c in calls:
        if c.get('caller') and not c['caller'].startswith('('):
            phones.add(c['caller'])

    print(f"涉及 {len(phones)} 个唯一号码:")
    for p in sorted(phones):
        print(f"  {p}")

    # 写入数据库
    for c in calls:
        phone = c.get('caller', '')
        contact = await db.lookup(phone)
        contact_id = contact['id'] if contact else None

        async with db.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO calls (contact_id, phone, direction, status, duration, "
                "recording_path, transcript, summary, created_at) "
                "VALUES ($1, $2, 'inbound', 'answered', $3, $4, $5, $6, $7)",
                contact_id, phone, c.get('duration', 0),
                c.get('wav'), c.get('transcript'), c.get('summary'),
                c.get('ts', '')
            )

    print(f"✅ 迁移完成: {len(calls)} 条记录")

if __name__ == '__main__':
    asyncio.run(migrate())
```

### 7.3 索引设计总结

| 表 | 索引 | 用途 |
|----|------|------|
| contacts | `phone_normalized` (UNIQUE) | 来电精确匹配 |
| contacts | `name gin_trgm_ops` (GIN) | 姓名模糊搜索 |
| contacts | `phone gin_trgm_ops` (GIN) | 号码模糊搜索 |
| contacts | `is_blacklist WHERE TRUE` (部分) | 黑名单快速查找 |
| contacts | `is_whitelist WHERE TRUE` (部分) | 白名单快速查找 |
| calls | `contact_id` | 按联系人查询 |
| calls | `created_at DESC` | 时间排序 |
| calls | `contact_id, created_at DESC` (复合) | 某人通话历史 |
| calls | `phone` | 裸号查询 |
| sms | `contact_id` | 按联系人查询短信 |
| sms | `created_at DESC` | 时间排序 |
| sms | `phone` | 裸号查询短信 |
| unknown_callers | `phone_normalized` (UNIQUE) | 去重 |
| unknown_callers | `labeled, label_suggested` (部分) | 待建议号码 |

---

## 八、实施计划

### Phase 1：PostgreSQL 通讯录（2-3 天）⭐ 最高优先级

| # | 任务 | 工时 | 交付物 | 验收标准 |
|---|------|------|--------|---------|
| 1.1 | 执行 init.sql 创建所有表 | 30min | 5张表+索引 | `\dt` 确认表存在 |
| 1.2 | 编写 contacts_db.py（CRUD） | 3h | contacts_db.py | 单元测试通过 |
| 1.3 | 编写 voice-cli.py（通讯录管理CLI） | 2h | voice-cli.py | add/search/list/blacklist 可用 |
| 1.4 | JSONL → PostgreSQL 迁移 | 1h | migrate_jsonl_to_pg.py | 23条记录入库 |
| 1.5 | 从现有23条提取4个号码预填 | 30min | init.sql 初始数据 | 来电可显示名称 |
| 1.6 | 改造 4g-combined-listener.py 集成通讯录 | 2h | voice_listener.py | 来电推送显示"姚旭打来" |

**里程碑**：来电微信推送显示联系人姓名而非裸号码

### Phase 2：录音质量修复（1-2天）

| # | 任务 | 工时 | 交付物 | 验收标准 |
|---|------|------|--------|---------|
| 2.1 | arecord 增益调整（-v 0.3）+ 16kHz | 1h | 修改 start_recording() | 新录音无 clipping |
| 2.2 | 录音后自动 dBFS 检测 | 1h | check_recording_quality() | 每次录音输出质量报告 |
| 2.3 | 录音 loudnorm 标准化 | 1h | post_process_audio() | 所有录音 -3dB 峰值 |
| 2.4 | WAV header 问题排查 | 2h | 修复 | soxi 显示正确时长 |

**里程碑**：清晰、不 clipping、格式正确的录音

### Phase 3：监听-处理解耦（2-3天）

| # | 任务 | 工时 | 交付物 | 验收标准 |
|---|------|------|--------|---------|
| 3.1 | 重构 voice-listener.py（移除ASR/LLM） | 3h | voice_listener.py | 只留AT+录音+事件写入 |
| 3.2 | 新建 voice-processor.py | 3h | voice_processor.py | 消费事件→转写→摘要→推送→入库 |
| 3.3 | 统一 LLM 摘要代码 | 1h | summarizer.py | 单一代码源，无冗余 |
| 3.4 | 统一 ASR 转写代码 | 1h | transcriber.py | FunASR + Whisper 封装 |
| 3.5 | 统一微信推送代码 | 1h | notifier.py | 单一代码源 |
| 3.6 | PM2 双进程配置 | 0.5h | ecosystem.4g.yaml | 两个进程独立运行 |
| 3.7 | 端到端回归测试 | 2h | 测试报告 | 完整通话→推送正常 |

**里程碑**：后处理不再阻塞来电监听，ASR耗时不影响接听

### Phase 4：差异化策略（1天）

| # | 任务 | 工时 | 交付物 | 验收标准 |
|---|------|------|--------|---------|
| 4.1 | 白名单直接接听 | 0.5h | listener.py 改造 | VIP 跳过振铃 |
| 4.2 | 黑名单自动挂断 | 0.5h | listener.py 改造 | 骚扰自动拦截 |
| 4.3 | 未知号码记录+建议推送 | 1h | unknown_callers 集成 | 3次来电后推送建议 |
| 4.4 | 重要联系人推送标记 | 0.5h | notifier.py 改造 | importance=2 加🔴 |
| 4.5 | 短信号码匹配通讯录 | 0.5h | sms 处理改造 | 短信显示姓名 |

**里程碑**：来电根据身份自动采取不同策略

### Phase 5：TTS 外呼（3-4天）

| # | 任务 | 工时 | 交付物 | 验收标准 |
|---|------|------|--------|---------|
| 5.1 | Edge-TTS Python 封装 | 2h | tts_client.py | synthesize() 可用 |
| 5.2 | 外呼流程实现 | 3h | outbound_call.py | ATD → TTS → 录音 → 挂断 |
| 5.3 | voice-cli "给XX打电话" | 2h | voice-cli.py 改造 | 通讯录查号自动拨打 |
| 5.4 | 中文短信发送修复 | 2h | sms_sender.py | 中文短信可发送 |
| 5.5 | 未接来电回拨提醒 | 1h | cron 任务 | 定时检查+推送 |

**里程碑**：自然语言拨号 + TTS 播报

### Phase 6：Voice Call AI（待定）

| # | 任务 | 工时 | 交付物 | 验收标准 |
|---|------|------|--------|---------|
| 6.1 | 来电转写 → LLM 回复 → TTS 播放 | 3h | voice_call_ai.py | 对方能听到 AI 回复 |
| 6.2 | 多轮对话支持 | 2h | 对话状态管理 | 连续对话 |
| 6.3 | 打断机制 | 2h | VAD + 关键词 | 用户说"停"可打断 |

**里程碑**：来电后可与 AI 对话（受限于单向音频）

### 总工作量估算

| Phase | 工时 | 日历时间 | 优先级 |
|-------|------|---------|--------|
| Phase 1 | 8-10h | 2-3天 | ⭐⭐⭐ 最高 |
| Phase 2 | 5-6h | 1-2天 | ⭐⭐⭐ |
| Phase 3 | 11-13h | 2-3天 | ⭐⭐ |
| Phase 4 | 3-4h | 1天 | ⭐⭐ |
| Phase 5 | 10-12h | 3-4天 | ⭐ |
| Phase 6 | 7-8h | 待定 | 待定 |
| **总计** | **~45-55h** | **~10-14天** | |

---

## 九、风险评估

### 风险矩阵

| ID | 风险 | 概率 | 影响 | 等级 | 状态 |
|----|------|------|------|------|------|
| R1 | 来电只显示号码（无通讯录） | 100% | 高 | 🔴 致命 | 已验证 |
| R2 | 录音 clipping + 电流声 | 100% | 高 | 🔴 致命 | 已验证 |
| R3 | ASR 阻塞监听 | 80% | 高 | 🔴 严重 | 代码确认 |
| R4 | 无法录到自己声音 | 100% | 中 | 🔴 严重 | 物理限制 |
| R5 | TTS 音频无法送入模块 | 100% | 高 | 🔴 严重 | 已验证 |
| R6 | 串口断开不恢复 | 30% | 中 | 🟡 中等 | 潜在 |
| R7 | FunASR 断网不可用 | 20% | 中 | 🟡 中等 | 有回退 |
| R8 | 并发写入冲突 | 10% | 低 | 🟢 低 | 可缓解 |
| R9 | 号码格式不统一 | 50% | 中 | 🟡 中等 | 可解决 |
| R10 | API Key 泄露 | 20% | 高 | 🟡 中等 | 代码确认 |
| R11 | 录音文件占满存储 | 100% | 低 | 🟢 低 | 长期问题 |
| R12 | WAV header 损坏 | 40% | 中 | 🟡 中等 | soxi 已确认 |

### 风险详细分析与解决方案

**R1：来电只显示号码（🔴 概率:100% 影响:高）**

- **根因**：无通讯录数据，CLIP 返回裸号码无法映射到身份
- **影响**：推送信息价值为零，无法做差异化处理，所有 AI 功能天花板
- **解决方案**：Phase 1 创建 PostgreSQL contacts 表 → 来电查表 → 推送显示姓名
- **验证方式**：来电后检查推送内容是否包含联系人姓名
- **残余风险**：无（通讯录数据建立后完全消除）

**R2：录音 clipping + 电流声（🔴 概率:100% 影响:高）**

- **根因**：① arecord 默认增益过高（max_volume=0.0dB）② 地环路噪声 ③ PH2.0 模拟信号质量不稳
- **影响**：0dB clipping 导致音频失真，ASR 转写准确率下降
- **解决方案**：
  1. `arecord -v 0.3` 降低增益到 30%
  2. 录音后 `ffmpeg -af "loudnorm=I=-16:TP=-3:LRA=11"` 标准化
  3. 每次录音自动检测 max_volume，> -1dB 标记"可能失真"
  4. 电流声需要硬件音频隔离器（物理层解决）
- **残余风险**：电流声需等硬件隔离器到货，软件方案只能降噪不能完全消除

**R3：ASR 阻塞来电监听（🔴 概率:80% 影响:高）**

- **根因**：4g-combined-listener.py 中 transcribe() 同步执行，FunASR 耗时 20-60 秒
- **影响**：阻塞期间串口缓冲区持续增长（>2000字节截断），可能漏接来电
- **解决方案**：拆分为两个进程 — 监听器只负责 AT 事件 + 录音 + 写事件文件；后处理器异步消费
- **验证方式**：通话结束后立即拨打第二通电话，检查是否漏接
- **残余风险**：无（解耦后完全消除）

**R4：无法录到自己声音（🔴 概率:100% 影响:中）**

- **根因**：A7670G VoLTE 通话音频走模块内部 IMS 协议栈，不经过 Linux ALSA 子系统
- **影响**：转写只包含对方声音；Voice Call AI 无法实现完整双向对话
- **解决方案**：接受此限制。通话录音只录对方声音，摘要标注"对方说..."
  - 对于 Voice Call AI：通过反向硬件环回（主机 aplay → 3.5mm 线 → 模块 MIC），可以实现 TTS 播放给对方听，但仍无法录到自己自然说话
  - pactl loopback 方案：只能捕获 Linux 侧播放的音频（TTS），不能捕获人类通过麦克风说的话
- **残余风险**：根本限制，无法完全消除。Voice Call AI 只能做到"AI 说话对方能听到"，做不到"人说AI能实时听到"

**R5：TTS 外呼音频无法送入模块（🔴 概率:100% 影响:高）**

- **根因**：A7670G 的 AT+CCMXPLAY 需要文件存储在模块内部 Flash，但文件上传机制不可用
- **影响**：外呼后无法播放 TTS 语音给对方
- **解决方案**：反向硬件环回 — 主机 TTS → aplay → 3.5mm 音频线 → 模块 MIC 输入
  - 需要模块的 MIC 引脚与 Audio OUT 物理连通（或外部接线）
  - 成本约 ¥5（一根 3.5mm 公对公音频线）
- **验证方式**：外呼拨打自己手机，播放 TTS，检查是否能听到
- **残余风险**：需要硬件连接；通话中的 MIC 输入可能与 Audio OUT 产生回声

**R6：串口断开不恢复（🟡 概率:30% 影响:中）**

- **根因**：USB 总线复位或模块重启导致 pyserial 抛 SerialException
- **影响**：重连间隙可能漏掉来电
- **解决方案**：
  1. PM2 `autorestart: true` + `max_restarts: 10` + `min_uptime: 5s`（已有）
  2. 重连后立即 AT+CLCC 检查残留通话
  3. 长期考虑：systemd `Restart=always` + `RestartSec=3` 替代 PM2
- **残余风险**：重连间隙（3-5秒）可能漏接，但概率极低

**R7：FunASR 断网不可用（🟡 概率:20% 影响:中）**

- **根因**：FunASR 依赖 dashscope API + catbox.moe 上传
- **影响**：断网时无法转写
- **解决方案**：已有 Whisper 本地回退（`whisper.load_model('large-v3-turbo')`），GPU 可用
- **残余风险**：Whisper 转写速度较慢（GPU 约 5-10 秒/分钟音频），但功能可用

**R8：并发写入冲突（🟢 概率:10% 影响:低）**

- **根因**：listener 和 processor 两个进程可能同时写 PostgreSQL
- **影响**：连接池耗尽或事务冲突
- **解决方案**：
  1. PostgreSQL 原生支持并发连接
  2. 使用 asyncpg 连接池（min_size=2, max_size=5）
  3. listener 和 processor 使用独立连接
- **残余风险**：无

**R9：号码格式不统一（🟡 概率:50% 影响:中）**

- **根因**：CLIP 返回格式多样（+86/无前缀/区号/空格/横线）
- **影响**：通讯录匹配失败
- **解决方案**：
  1. `normalize_phone()` 统一处理：去 +86、去空格/横线/括号、去长途
  2. `phone_normalized` 字段存储标准化后的号码
  3. 后7位模糊匹配作为兜底策略（`RIGHT(phone_normalized, 7)`）
  4. 所有写入数据库的号码都经过标准化
- **残余风险**：极低（标准化函数 + 模糊匹配双重保障）

**R10：API Key 硬编码（🟡 概率:20% 影响:高）**

- **根因**：DeepSeek Key、DashScope Key 硬编码在多个 Python 脚本中
- **影响**：维护困难（改 Key 要改多个文件），Git 泄露风险
- **解决方案**：
  1. 统一配置到 `voice-system/config/settings.yaml`
  2. `settings.yaml` 加入 `.gitignore`
  3. 代码通过 `settings.yaml` 加载配置
  4. 环境变量作为 fallback（`os.environ.get('DEEPSEEK_KEY')`）
- **残余风险**：低（集中管理后降低泄露和维护成本）

```yaml
# voice-system/config/settings.yaml
# ⚠️ 不纳入 Git 版本控制
llm:
  deepseek_api_key: "sk-xxxxxxxx"
  deepseek_model: "deepseek-chat"
  deepseek_base_url: "https://api.deepseek.com/v1"
asr:
  dashscope_api_key: "sk-xxxxxxxx"
  funasr_model: "fun-asr"
  whisper_model: "large-v3-turbo"
wechat:
  target: "o9cq809401Af26gJM8UaJGc6KjBo@im.weixin"
  channel: "openclaw-weixin"
database:
  dsn: "postgresql://openclaw_ai:password@localhost:5432/openclaw_memory"
tts:
  voice: "zh-CN-YunxiNeural"
```

**R11：录音文件无限增长（🟢 概率:100% 影响:低）**

- **根因**：录音文件无清理策略
- **影响**：长期占满磁盘（23条已 ~7MB，一年后约 ~100MB）
- **解决方案**：
  ```bash
  # cron 每周执行：保留最近30天录音，更早的删除但保留转写+摘要
  0 3 * * 0 find /home/ai/.openclaw/workspace/voice-system/recordings/inbound/ -name "*.wav" -mtime +30 -delete
  ```
- **残余风险**：无

**R12：WAV header 损坏（🟡 概率:40% 影响:中）**

- **根因**：arecord 被 terminate 时可能未正确写入 WAV header
- **影响**：soxi 显示异常时长（37:16:57），部分播放器无法播放
- **解决方案**：
  1. 录音结束后用 ffmpeg 重新封装修复 header：
     ```bash
     ffmpeg -y -f s16le -ar 8000 -ac 1 -i input.raw -ar 16000 output.wav
     ```
  2. 或者改用 raw PCM 格式录音，后期统一转 WAV：
     ```bash
     arecord -D plughw:1,0 -f S16_LE -r 16000 -c 1 -t raw output.raw
     ffmpeg -y -f s16le -ar 16000 -ac 1 -i output.raw output.wav
     ```
- **验证方式**：录音结束后 soxi 检查时长是否正确
- **残余风险**：低（修复后消除）

---

## 十、技术选型

### 10.1 数据库

| 选项 | 选择 | 理由 |
|------|------|------|
| PostgreSQL | ✅ 已用 | Docker pg16 在运行，pg_trgm 支持模糊搜索，原生并发，asyncpg 异步驱动 |
| SQLite | ❌ 不选 | 虽然轻量但功能受限，并发不如 PG，已有 PG 环境无需重复 |
| MySQL | ❌ 不选 | 无现有环境，pg_trgm 模糊搜索 MySQL 不支持 |

### 10.2 进程管理

| 选项 | 选择 | 理由 |
|------|------|------|
| PM2 | ✅ 当前 | 已在运行，配置简单，自动重启 |
| systemd | ⏳ 评估中 | 更可靠（cgroup 资源限制），但改动较大，Phase 3 后评估 |

### 10.3 ASR 引擎

| 选项 | 选择 | 理由 |
|------|------|------|
| FunASR (dashscope) | ✅ 主力 | 中文转写质量好 |
| Whisper (local) | ✅ 兜底 | GPU 可用，断网可用，`large-v3-turbo` 模型 |
| Faster-Whisper | ⏳ 考虑 | 比原生 whisper 快 4 倍，Phase 6 评估 |

### 10.4 LLM

| 选项 | 选择 | 理由 |
|------|------|------|
| DeepSeek Qwen-max | ✅ 当前 | 中文摘要质量好 |
| MiniMax | ❌ 不可用 | API Key 格式错误 |
| 本地 Ollama | ⏳ 考虑 | 隐私场景可用，但速度慢 (~26s) |

### 10.5 TTS

| 选项 | 选择 | 理由 |
|------|------|------|
| Edge-TTS | ✅ 已安装 | 免费，中文质量好，7.2.8 已安装 |
| Youdao TTS | ⏳ 备选 | 已配置，待测试 |

### 10.6 数据库驱动

| 选项 | 选择 | 理由 |
|------|------|------|
| asyncpg | ✅ 推荐 | 异步，高性能，Python 3.12 兼容 |
| psycopg2 | ⏳ 备选 | 同步，成熟但阻塞事件循环 |
| psycopg | ⏳ 备选 | psycopg2 的现代异步版本 |

### 10.7 不选择的技术

| 技术 | 不选原因 |
|------|---------|
| FreeSWITCH / Asterisk | A7670G 不走 SIP，完全不可用 |
| SIP 录音 | 模块 VoLTE 不走 SIP 协议栈 |
| 模块内部录音 (AT+CREC) | 文件无法导出 |
| 模块内部播放 (AT+CCMXPLAY) | 文件无法上传 |
| 实时双向 Voice Call AI | 硬件限制：无法捕获自己声音到 Linux |

---

## 十一、代码目录结构（最终目标）

```
/home/ai/.openclaw/workspace/voice-system/
│
├── sql/                          # 数据库脚本
│   ├── init.sql                  # 建表脚本
│   ├── contacts.sql              # contacts 表 DDL
│   ├── calls.sql                 # calls 表 DDL
│   ├── sms.sql                   # sms 表 DDL
│   ├── unknown_callers.sql       # unknown_callers 表 DDL
│   └── system_log.sql            # system_log 表 DDL
│
├── config/
│   └── settings.yaml             # 统一配置（不纳入 git）
│
├── src/
│   ├── voice_listener.py         # 进程1：AT 监听器（重构后）
│   ├── voice_processor.py        # 进程2：后处理器
│   ├── contacts_db.py            # PostgreSQL 通讯录操作
│   ├── transcriber.py            # ASR 转写（FunASR + Whisper）
│   ├── summarizer.py             # LLM 摘要生成
│   ├── notifier.py               # 微信推送
│   ├── tts_client.py             # Edge-TTS 封装
│   ├── outbound_call.py          # 外呼管理
│   ├── sms_sender.py             # 短信发送（UCS2 PDU）
│   ├── voice_call_ai.py          # Voice Call AI
│   └── audio_utils.py            # 音频工具（质量检测、标准化）
│
├── scripts/                      # CLI 工具
│   ├── voice-cli.py              # 通讯录/通话管理 CLI
│   ├── migrate_jsonl_to_pg.py    # JSONL → PostgreSQL 迁移
│   ├── 4g-call                   # 保留：拨号 CLI
│   ├── 4g-sms                    # 保留：短信 CLI
│   ├── 4g-answer                 # 保留：接听 CLI
│   └── 4g-sms-decode.py          # 保留：PDU 解码
│
├── data/
│   ├── calls.jsonl               # 保留：旧数据（迁移后不再更新）
│   └── greeting_4g.wav           # 提示音
│
├── recordings/
│   ├── inbound/                  # 来电录音
│   └── outbound/                 # 外呼录音
│
├── ecosystem.4g.yaml             # PM2 配置（双进程）
├── start-4g.sh                   # 启动脚本
├── PLAN-COMBINED-FINAL.md        # 旧方案（保留参考）
└── PLAN-FINAL-v3.md              # 旧方案 v3（保留参考）

/tmp/voice-events/                # 事件队列（运行时）
├── {uuid}.json                   # 待处理事件
└── processed/                    # 已处理事件（可定期清理）
```

---

## 十二、PM2 双进程配置

```yaml
# voice-system/ecosystem.4g.yaml
apps:
  # 进程1：AT 监听器（毫秒级响应）
  - name: voice-listener
    script: /home/ai/.openclaw/workspace/voice-system/src/voice_listener.py
    interpreter: python3
    instances: 1
    autorestart: true
    max_restarts: 10
    min_uptime: 10s
    kill_timeout: 5000
    exp_backoff_restart_delay: 1000
    watch: false
    env:
      PYTHONUNBUFFERED: "1"

  # 进程2：后处理器（异步，不阻塞）
  - name: voice-processor
    script: /home/ai/.openclaw/workspace/voice-system/src/voice_processor.py
    interpreter: python3
    instances: 1
    autorestart: true
    max_restarts: 5
    min_uptime: 10s
    kill_timeout: 5000
    exp_backoff_restart_delay: 2000
    watch: false
    env:
      PYTHONUNBUFFERED: "1"
```

---

## 十三、voice-cli.py 设计

```bash
# 通讯录管理
voice-cli contact add --name "老妈" --phone "13980819087" --relationship "家人" --importance 2
voice-cli contact add --name "快递" --phone "95546" --relationship "快递" --is-whitelist
voice-cli contact blacklist "13700000000"

# 搜索
voice-cli contact search "老妈"
voice-cli contact search "139"

# 列表
voice-cli contact list
voice-cli contact list --relationship "家人"
voice-cli contact list --blacklist

# 通话查询
voice-cli call list --today
voice-cli call list --contact "老妈"
voice-cli call list --last 10
voice-cli call stats --month

# 未知号码
voice-cli unknown list
voice-cli unknown add --phone "13700000000" --name "张三"

# 系统状态
voice-cli system status
voice-cli system logs listener --lines 50
voice-cli system logs processor --lines 50
```

---

## 十四、核心风险总结

### 不可克服的硬件限制

| 限制 | 影响 | 应对 |
|------|------|------|
| VoLTE 音频不经过 Linux | 无法录到自己声音 | 接受限制，只录对方声音 |
| 文件无法上传模块 | TTS 无法通过 AT+CCMXPLAY 播放 | 用反向硬件环回 |
| 模块 MIC 与 Audio OUT 物理分离 | 反向环回需要外部接线 | ¥5 音频线 + 硬件连接 |

### 可完全解决的风险

| 风险 | 解决后状态 |
|------|-----------|
| 来电只显示号码 | → 显示联系人姓名 |
| 录音 clipping | → 增益控制 + 标准化 |
| ASR 阻塞监听 | → 两进程解耦 |
| 号码格式不统一 | → 标准化 + 模糊匹配 |
| JSONL 无法查询 | → PostgreSQL 结构化存储 |
| API Key 硬编码 | → settings.yaml 统一管理 |

### 部分缓解的风险

| 风险 | 缓解后状态 |
|------|-----------|
| 电流声 | 软件降噪可降低，完全消除需硬件隔离器 |
| 串口断开 | 自动重连，3-5秒间隙可能漏接 |
| FunASR 断网 | Whisper 兜底，质量略降但可用 |

---

## 十五、一句话总结

**Phase 1 建通讯录（PostgreSQL，最小改动最大收益）→ Phase 2 修录音质量 → Phase 3 解耦监听与处理 → Phase 4 差异化策略 → Phase 5 TTS 外呼 → Phase 6 Voice Call AI（受限于单向音频）。**

**核心原则：先解决已有数据能解决的问题（通讯录/录音质量），再解决架构问题（解耦），最后做新功能（TTS/Voice AI）。硬件限制不可逾越的，明确标注并寻找替代方案。**

---

_报告结束。等待审批后按 Phase 1 开始执行。_
