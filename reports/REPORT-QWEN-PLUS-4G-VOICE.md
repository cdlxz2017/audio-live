# 4G语音通讯系统完整重构方案

> **编制**：玄枢（太虚智网灵枢）
> **日期**：2026-04-14
> **版本**：v1.0
> **状态**：待审批执行

---

## 1. 系统架构设计

### 1.1 现状深度诊断

```
┌─────────────────────────────────────────────────────────────┐
│                    当前架构（单体式，v7）                      │
│                                                             │
│  4g-combined-listener.py (单进程 497行)                      │
│  ├─ 串口监听（RING / CLIP）                                   │
│  ├─ ATA 接听 + VOICE CALL BEGIN 检测                          │
│  ├─ arecord 硬件环回录音                                      │
│  ├─ FunASR 转写（同步，20-60秒）                               │
│  ├─ push_call_summary.py 子进程（LLM + 微信推送）             │
│  └─ JSONL 写入                                                │
│                                                             │
│  🔴 核心问题：所有操作在同一进程、同一线程、同一循环中串行执行    │
│  🔴 ASR转写阻塞期间，串口无响应 → 漏接来电                      │
│  🔴 无通讯录 → 来电只显示裸号码                                │
│  🔴 无结构化存储 → 无法查询/聚合                               │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 目标架构（解耦式）

```
┌──────────────────────────────────────────────────────────────────┐
│                       4G 语音系统 v2.0                           │
│                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐ │
│  │  串口层      │     │  事件总线    │     │    后处理层           │ │
│  │  listener   │────▶│  (Redis     │────▶│  processor          │ │
│  │  (AT监听)   │     │   Stream)   │     │  (异步队列消费)      │ │
│  │  毫秒级响应  │     │             │     │                     │ │
│  └─────────────┘     └─────────────┘     ├─────────────────────┤ │
│        │                                    │ ASR转写 (FunASR)  │ │
│        │  AT指令                            │ LLM摘要           │ │
│        ▼                                    │ 微信推送          │ │
│  ┌─────────────┐                            │ DB写入            │ │
│  │  硬件控制层  │                            └─────────────────────┘ │
│  │  A7670G模块 │                                      │             │
│  │  ATD/ATA/   │                                      ▼             │
│  │  CHUP/      │                            ┌─────────────────────┐ │
│  │  SMS        │                            │   PostgreSQL        │ │
│  └─────────────┘                            │   openclaw_memory   │ │
│        ▲                                    │   - contacts        │ │
│        │                                    │   - calls           │ │
│        │  查询                               │   - sms             │ │
│        │                                    │   - call_logs       │ │
│  ┌─────────────┐                            │   - tasks           │ │
│  │  通讯录服务  │                            └─────────────────────┘ │
│  │  contacts   │                                      │             │
│  │  服务       │                                      │ 查询         │
│  │  (CRUD API) │◀─────────────────────────────────────┘             │
│  └─────────────┘                                                    │
│        ▲                                                            │
│        │  CLI / API                                                  │
│        │                                                            │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐    │
│  │  OpenClaw   │     │  微信推送   │     │  TTS外呼 (Edge-TTS) │    │
│  │  message    │     │  (WeChat)   │     │  + 反向环回          │    │
│  └─────────────┘     └─────────────┘     └─────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 1.3 核心模块划分

| 模块 | 职责 | 进程 | 语言 |
|------|------|------|------|
| **listener** | 串口AT监听、来电检测、ATA接听、录音启动/停止 | PM2: `4g-listener` | Python3 |
| **processor** | 事件消费：ASR转写 → LLM摘要 → 微信推送 → DB写入 | PM2: `4g-processor` | Python3 |
| **contacts** | 通讯录CRUD、来电号码匹配、黑白名单策略 | 库（被listener调用） | Python3 |
| **outbound** | 外呼管理、TTS播报、自然语言拨号 | 独立脚本 | Python3 |
| **sms-handler** | 短信接收/PDU解码/发送（兼容现有） | 独立进程/集成到listener | Python3 |

### 1.4 数据流设计

```
来电流程：
  串口RING → listener检测 → contacts查询号码 → 策略判断(黑/白/普通)
  → ATA接听 → arecord录音 → 写入Redis Stream事件 → listener返回监听

后处理流程：
  processor消费事件 → 录音→FunASR转写→Whisper兜底→LLM摘要
  → contacts查询姓名→微信推送("老妈打来电话，摘要...") → DB写入

外呼流程：
  用户指令 → 查contacts → ATD拨号 → VOICE CALL BEGIN检测
  → Edge-TTS生成语音 → ffmpeg→ALSA反向环回 → arecord录音
  → 通话结束→后处理管线→推送
```

---

## 2. 通讯录模块（最优先 - Phase 1）

### 2.1 PostgreSQL Schema 设计

数据库：`openclaw_memory`，用户：`openclaw_ai`，主机：`localhost:5432`

```sql
-- contacts 表：通讯录核心
CREATE TABLE IF NOT EXISTS contacts (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(100) NOT NULL,           -- 姓名/称呼
    phone            VARCHAR(20) UNIQUE NOT NULL,     -- 原始手机号
    phone_normalized VARCHAR(20) NOT NULL,            -- 标准化后（去+86/空格/-）
    relationship     VARCHAR(20),                     -- 家人/同事/朋友/快递/客服/其他
    importance       SMALLINT DEFAULT 0,              -- 0=普通 1=重要 2=紧急
    is_blacklist     BOOLEAN DEFAULT FALSE,           -- 黑名单（自动挂断）
    is_whitelist     BOOLEAN DEFAULT FALSE,           -- 白名单（跳过振铃直接接听）
    last_call_at     TIMESTAMPTZ,                     -- 最后通话时间
    call_count       INTEGER DEFAULT 0,               -- 累计通话次数
    notes            TEXT,                            -- 备注
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- calls 表：通话记录
CREATE TABLE IF NOT EXISTS calls (
    id               SERIAL PRIMARY KEY,
    direction        VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    caller_phone     VARCHAR(20) NOT NULL,            -- 对方号码
    contact_id       INTEGER REFERENCES contacts(id), -- 关联通讯录
    start_time       TIMESTAMPTZ NOT NULL,
    end_time         TIMESTAMPTZ,
    duration         INTEGER,                         -- 秒
    status           VARCHAR(20) DEFAULT 'completed', -- completed/missed/rejected/busy
    wav_path         TEXT,                            -- 录音文件路径
    transcript       TEXT,                            -- ASR转写
    summary          TEXT,                            -- LLM摘要
    raw_transcript   JSONB,                           -- ASR原始结果（含时间戳）
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- sms 表：短信记录
CREATE TABLE IF NOT EXISTS sms (
    id               SERIAL PRIMARY KEY,
    direction        VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    sender_phone     VARCHAR(20) NOT NULL,
    contact_id       INTEGER REFERENCES contacts(id),
    content          TEXT,                            -- 短信内容
    pdu_raw          TEXT,                            -- 原始PDU（调试用）
    status           VARCHAR(20) DEFAULT 'received',  -- received/sent/failed
    received_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- unknown_numbers 表：未知号码学习
CREATE TABLE IF NOT EXISTS unknown_numbers (
    id               SERIAL PRIMARY KEY,
    phone            VARCHAR(20) NOT NULL,
    phone_normalized VARCHAR(20) NOT NULL,
    first_seen       TIMESTAMPTZ DEFAULT NOW(),
    last_seen        TIMESTAMPTZ DEFAULT NOW(),
    call_count       INTEGER DEFAULT 1,
    total_duration   INTEGER DEFAULT 0,
    has_been_notified BOOLEAN DEFAULT FALSE,          -- 是否已通知用户
    suggested_name   VARCHAR(100),                    -- AI建议的名称
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- call_tasks 表：异步任务队列
CREATE TABLE IF NOT EXISTS call_tasks (
    id               SERIAL PRIMARY KEY,
    call_id          INTEGER REFERENCES calls(id),
    task_type        VARCHAR(30) NOT NULL,            -- transcribe/summarize/push
    status           VARCHAR(20) DEFAULT 'pending',   -- pending/running/done/failed
    payload          JSONB,                           -- 任务参数
    result           JSONB,                           -- 任务结果
    error            TEXT,                            -- 错误信息
    retries          INTEGER DEFAULT 0,
    max_retries      INTEGER DEFAULT 3,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 索引设计

```sql
-- contacts
CREATE INDEX idx_contacts_phone_normalized ON contacts(phone_normalized);
CREATE INDEX idx_contacts_relationship ON contacts(relationship);
CREATE INDEX idx_contacts_blacklist ON contacts(is_blacklist) WHERE is_blacklist = TRUE;
CREATE INDEX idx_contacts_whitelist ON contacts(is_whitelist) WHERE is_whitelist = TRUE;

-- calls
CREATE INDEX idx_calls_direction ON calls(direction);
CREATE INDEX idx_calls_start_time ON calls(start_time DESC);
CREATE INDEX idx_calls_contact ON calls(contact_id);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_caller_phone ON calls(caller_phone);
CREATE INDEX idx_calls_start_contact ON calls(start_time DESC, contact_id);

-- sms
CREATE INDEX idx_sms_direction ON sms(direction);
CREATE INDEX idx_sms_received ON sms(received_at DESC);
CREATE INDEX idx_sms_contact ON sms(contact_id);

-- unknown_numbers
CREATE INDEX idx_unknown_phone_normalized ON unknown_numbers(phone_normalized);
CREATE INDEX idx_unknown_count ON unknown_numbers(call_count DESC);

-- call_tasks
CREATE INDEX idx_tasks_status ON call_tasks(status) WHERE status = 'pending';
CREATE INDEX idx_tasks_call ON call_tasks(call_id);
```

### 2.3 号码标准化函数

```sql
CREATE OR REPLACE FUNCTION normalize_phone(raw_phone TEXT)
RETURNS TEXT AS $$
BEGIN
    -- 去空格、横线、括号
    raw_phone := regexp_replace(raw_phone, '[\s\-\(\)]', '', 'g');
    -- 去 +86 前缀
    IF raw_phone LIKE '+86%' THEN
        raw_phone := substr(raw_phone, 4);
    END IF;
    -- 去 86 前缀（无+号）
    IF raw_phone LIKE '86%' AND length(raw_phone) = 13 THEN
        raw_phone := substr(raw_phone, 3);
    END IF;
    RETURN raw_phone;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 号码匹配函数（后N位模糊匹配）
CREATE OR REPLACE FUNCTION match_phone(phone1 TEXT, phone2 TEXT, min_tail INT DEFAULT 7)
RETURNS BOOLEAN AS $$
DECLARE
    norm1 TEXT;
    norm2 TEXT;
    len1 INT;
    len2 INT;
    cmp_len INT;
BEGIN
    norm1 := normalize_phone(phone1);
    norm2 := normalize_phone(phone2);
    
    IF norm1 = norm2 THEN
        RETURN TRUE;
    END IF;
    
    len1 := length(norm1);
    len2 := length(norm2);
    cmp_len := LEAST(min_tail, len1, len2);
    
    RETURN right(norm1, cmp_len) = right(norm2, cmp_len);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### 2.4 CRUD API 设计（Python 库）

```python
# voice-system/lib/contacts_db.py
"""
通讯录数据库操作库
连接 openclaw_memory 数据库，操作 contacts / calls / sms 表
"""
import psycopg2
import psycopg2.extras
from datetime import datetime
from typing import Optional

DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'user': 'openclaw_ai',
    'password': 'zyxrcy910128',
    'database': 'openclaw_memory',
}

def get_connection():
    return psycopg2.connect(**DB_CONFIG)

# ── 标准化 ──
def normalize_phone(raw: str) -> str:
    import re
    phone = re.sub(r'[\s\-\(\)]', '', raw)
    if phone.startswith('+86'):
        phone = phone[3:]
    elif phone.startswith('86') and len(phone) == 13:
        phone = phone[2:]
    return phone

# ── 来电识别（核心）──
def identify_caller(phone: str) -> Optional[dict]:
    """
    来电识别流程：
    1. 精确匹配 normalized phone
    2. 后7位模糊匹配
    3. 查 unknown_numbers
    4. 返回联系人信息或 None
    """
    norm = normalize_phone(phone)
    conn = get_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # 1. 精确匹配
    cur.execute(
        "SELECT id, name, phone, relationship, importance, is_blacklist, is_whitelist, call_count "
        "FROM contacts WHERE phone_normalized = %s",
        (norm,)
    )
    contact = cur.fetchone()
    if contact:
        cur.close(); conn.close()
        return dict(contact)
    
    # 2. 后7位模糊匹配
    tail = norm[-7:] if len(norm) >= 7 else norm
    cur.execute(
        "SELECT id, name, phone, relationship, importance, is_blacklist, is_whitelist, call_count "
        "FROM contacts WHERE right(phone_normalized, %s) = %s",
        (len(tail), tail)
    )
    contact = cur.fetchone()
    if contact:
        cur.close(); conn.close()
        return dict(contact)
    
    cur.close(); conn.close()
    return None

# ── 添加联系人 ──
def add_contact(name: str, phone: str, relationship: str = None, importance: int = 0) -> int:
    norm = normalize_phone(phone)
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO contacts (name, phone, phone_normalized, relationship, importance) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (name, phone, norm, relationship, importance)
    )
    cid = cur.fetchone()[0]
    conn.commit(); cur.close(); conn.close()
    return cid

# ── 黑白名单 ──
def set_blacklist(phone: str, is_black: bool = True):
    norm = normalize_phone(phone)
    conn = get_connection(); cur = conn.cursor()
    cur.execute("UPDATE contacts SET is_blacklist=%s, is_whitelist=FALSE, updated_at=NOW() WHERE phone_normalized=%s",
                (is_black, norm))
    conn.commit(); cur.close(); conn.close()

def set_whitelist(phone: str, is_white: bool = True):
    norm = normalize_phone(phone)
    conn = get_connection(); cur = conn.cursor()
    cur.execute("UPDATE contacts SET is_whitelist=%s, is_blacklist=FALSE, updated_at=NOW() WHERE phone_normalized=%s",
                (is_white, norm))
    conn.commit(); cur.close(); conn.close()

# ── 通话后更新 ──
def update_call_stats(phone: str, duration: int):
    """通话结束后更新联系人的最后通话时间和累计次数"""
    norm = normalize_phone(phone)
    conn = get_connection(); cur = conn.cursor()
    cur.execute(
        "UPDATE contacts SET last_call_at=NOW(), call_count=call_count+1, updated_at=NOW() "
        "WHERE phone_normalized=%s", (norm,)
    )
    conn.commit(); cur.close(); conn.close()

# ── 未知号码记录 ──
def record_unknown(phone: str, duration: int = 0) -> int:
    """记录未知号码，若已存在则更新"""
    norm = normalize_phone(phone)
    conn = get_connection(); cur = conn.cursor()
    cur.execute(
        "INSERT INTO unknown_numbers (phone, phone_normalized, call_count, total_duration, last_seen) "
        "VALUES (%s, %s, 1, %s, NOW()) "
        "ON CONFLICT (phone_normalized) DO UPDATE SET "
        "last_seen=NOW(), call_count=unknown_numbers.call_count+1, total_duration=unknown_numbers.total_duration+%s "
        "RETURNING id",
        (phone, norm, duration, duration)
    )
    uid = cur.fetchone()[0]
    conn.commit(); cur.close(); conn.close()
    return uid

# ── 写入通话记录 ──
def insert_call(direction: str, phone: str, start_time: datetime, end_time: datetime = None,
                duration: int = 0, status: str = 'completed', wav_path: str = None,
                transcript: str = None, summary: str = None) -> int:
    norm = normalize_phone(phone)
    conn = get_connection(); cur = conn.cursor()
    
    # 先尝试匹配联系人
    cur.execute("SELECT id FROM contacts WHERE phone_normalized = %s", (norm,))
    row = cur.fetchone()
    contact_id = row[0] if row else None
    
    cur.execute(
        "INSERT INTO calls (direction, caller_phone, contact_id, start_time, end_time, duration, "
        "status, wav_path, transcript, summary) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (direction, norm, contact_id, start_time, end_time, duration, status, wav_path, transcript, summary)
    )
    call_id = cur.fetchone()[0]
    conn.commit(); cur.close(); conn.close()
    return call_id
```

### 2.5 来电识别完整流程

```
来电 RING
    ↓
提取 CLIP 号码
    ↓
normalize_phone() 标准化
    ↓
contacts_db.identify_caller(phone)
    ↓
┌─── 找到联系人 ─────────────┐
│  检查 is_blacklist          │
│    → True → AT+CHUP 挂断   │
│    → False → 检查 is_whitelist│
│      → True → 跳过振铃直接ATA │
│      → False → RING≥2后ATA   │
│  推送微信："📞 {name}打来电话" │
└─────────────────────────────┘
┌─── 未找到联系人 ────────────┐
│  写入 unknown_numbers        │
│  保持现有逻辑（RING≥2后ATA） │
│  推送微信："📞 未知号码 {phone} 打来"│
│  若 call_count ≥ 3 且未通知  │
│    → 推送提醒："此号码来电3次，是否加入通讯录？"│
└─────────────────────────────┘
```

---

## 3. 通话管理模块

### 3.1 精简版监听器（核心改动）

```python
# voice-system/src/listener.py（替代现有的4g-combined-listener.py）
"""
4G 模块监听器 v2.0 — 只负责：AT监听 → 接听 → 录音 → 事件写入
不阻塞、不转写、不推送。毫秒级响应。
"""
import serial, time, re, os, subprocess, json, glob, threading, signal
from datetime import datetime
import psycopg2

# ── 配置 ──
SERIAL_PORT = '/dev/serial/by-id/usb-SIMCom_Wireless_Solution_A76XX_Series_LTE_Module_*-if02-port0'
BAUD = 115200
LOG_FILE = '/home/ai/.openclaw/workspace/logs/4g-listener.log'
RECORDINGS_IN = '/home/ai/.openclaw/workspace/voice-system/recordings/inbound'
EVENT_DIR = '/home/ai/.openclaw/workspace/voice-system/events/inbound'

os.makedirs(RECORDINGS_IN, exist_ok=True)
os.makedirs(EVENT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

# ── 依赖 ──
import sys
sys.path.insert(0, '/home/ai/.openclaw/workspace/voice-system/lib')
from contacts_db import identify_caller, set_blacklist, update_call_stats, record_unknown

# ── 状态 ──
class CallState:
    def __init__(self):
        self.in_call = False
        self.caller = None
        self.rec_proc = None
        self.rec_path = None
        self.call_start = None
        self.ring_count = 0
        self.ringing = False
        self.audio_device = None
        self.ser = None

state = CallState()

def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

# ── 端口发现 ──
def find_port():
    patterns = [
        '/dev/serial/by-id/usb-SIMCom_Wireless_Solution_A76XX_Series_LTE_Module_*-if02-port0',
    ]
    for p in patterns:
        matches = sorted(glob.glob(p))
        if matches:
            return matches[0]
    for p in sorted(glob.glob('/dev/serial/by-id/*SIMCom*')):
        if 'if02' in p:
            return p
    return None

# ── 音频设备 ──
def find_audio_device():
    try:
        result = subprocess.run(['arecord', '-l'], capture_output=True, text=True, timeout=5)
        for line in result.stdout.splitlines():
            if 'USB' in line.upper() or 'AUDIO' in line.upper():
                m = re.match(r'card\s+(\d+):', line)
                if m:
                    return f'plughw:{m.group(1)},0'
    except:
        pass
    return 'plughw:1,0'

# ── 录音 ──
def start_recording(out_path):
    dev = state.audio_device or 'plughw:1,0'
    # 改进：降低增益避免clipping，使用16kHz采样（直接适配ASR）
    state.rec_proc = subprocess.Popen(
        ['arecord', '-D', dev, '-f', 'S16_LE', '-r', '16000', '-c', '1',
         '-v', '0.3',  # 30% 音量避免 clipping
         out_path],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    log(f"[录音] 开始 PID={state.rec_proc.pid} 设备={dev}")

def stop_recording():
    if state.rec_proc:
        state.rec_proc.terminate()
        try:
            state.rec_proc.wait(timeout=5)
        except:
            state.rec_proc.kill()
        log("[录音] 停止")
        state.rec_proc = None

# ── AT命令 ──
def at_cmd(cmd, delay=0.5):
    state.ser.write((cmd + '\r\n').encode())
    time.sleep(delay)
    resp = ''
    deadline = time.time() + 2.0
    while time.time() < deadline:
        if state.ser.in_waiting > 0:
            resp += state.ser.read(state.ser.in_waiting).decode(errors='replace')
        time.sleep(0.05)
    return resp

# ── 播放提示音（异步）──
def play_greeting_async():
    greeting = '/home/ai/.openclaw/workspace/voice-system/data/greeting_4g.wav'
    if not os.path.exists(greeting):
        return
    def _play():
        dev = state.audio_device or 'plughw:1,0'
        subprocess.run(['ffmpeg', '-y', '-i', greeting, '-af', 'volume=2.5',
                        '-ar', '48000', '-ac', '2', '-f', 'alsa', dev],
                       capture_output=True, timeout=15)
    threading.Thread(target=_play, daemon=True).start()

# ── 写入事件文件（解耦关键）──
def write_event(event_type, data):
    """
    将通话事件写入文件队列，processor 轮询消费
    使用 .pending 后缀，processor 处理完改为 .done
    """
    ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    filename = f"{ts}_{event_type}.json"
    filepath = os.path.join(EVENT_DIR, filename)
    with open(filepath, 'w') as f:
        json.dump(data, f, ensure_ascii=False)
    log(f"[事件] 写入: {filename}")

# ── 来电策略决策 ──
def decide_incoming_action(phone):
    contact = identify_caller(phone)
    if contact:
        if contact.get('is_blacklist'):
            return 'reject', contact
        elif contact.get('is_whitelist'):
            return 'answer_immediate', contact
        else:
            return 'answer_after_ring', contact
    else:
        return 'answer_after_ring', None

# ── 主循环 ──
def main():
    global state
    state.audio_device = find_audio_device()
    
    port = find_port()
    if not port:
        log("❌ 无可用端口，退出"); return
    
    while True:
        try:
            state.ser = serial.Serial(port, BAUD, timeout=0)
            state.ser.flushInput()
            log(f"串口已连接: {port}")
            
            at_cmd('AT+CREG=0')
            at_cmd('AT+CEREG=0')
            at_cmd('AT+CLIP=1')
            at_cmd('AT+CNMI=2,1,0,1,0')
            at_cmd('AT+CLCC=1')
            log("模块初始化完成")
            
            buffer = ''
            
            while True:
                if state.ser.in_waiting > 0:
                    data = state.ser.read(state.ser.in_waiting).decode(errors='replace')
                    buffer += data
                    
                    # ── 来电检测 ──
                    if not state.in_call:
                        clip_m = re.search(r'\+CLIP:\s*"([^"]+)"', buffer)
                        if clip_m:
                            caller = clip_m.group(1)
                            log(f"📞 来电: {caller}")
                            state.caller = caller
                        
                        ring_matches = re.findall(r'\bRING\b', buffer)
                        if ring_matches:
                            state.ring_count += len(ring_matches)
                            if not state.ringing:
                                state.ringing = True
                        
                        # 策略决策
                        if state.ringing and state.caller:
                            action, contact = decide_incoming_action(state.caller)
                            
                            if action == 'reject':
                                log(f"🚫 黑名单: {contact['name']}({state.caller})，自动挂断")
                                at_cmd('AT+CHUP')
                                write_event('rejected', {
                                    'caller': state.caller,
                                    'contact': contact,
                                    'time': datetime.now().isoformat()
                                })
                                state.ringing = False
                                state.ring_count = 0
                                state.caller = None
                                buffer = ''
                                continue
                            
                            threshold = 1 if action == 'answer_immediate' else 2
                            if state.ring_count >= threshold:
                                log(f"📞 接听: {state.caller} action={action}")
                                state.ser.write(b'ATA\r\n')
                                time.sleep(0.3)
                                
                                answered = False
                                for _ in range(20):
                                    if state.ser.in_waiting > 0:
                                        buffer += state.ser.read(state.ser.in_waiting).decode(errors='replace')
                                    if 'VOICE CALL: BEGIN' in buffer:
                                        answered = True
                                        break
                                    time.sleep(0.2)
                                
                                if not answered:
                                    resp = at_cmd('AT+CLCC', delay=0.5)
                                    m = re.search(r'\+CLCC:\s*\d+,\d+,(\d+)', resp)
                                    if m and m.group(1) == '0':
                                        answered = True
                                
                                if answered:
                                    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                                    safe = re.sub(r'\D', '', state.caller)[-11:]
                                    state.rec_path = os.path.join(RECORDINGS_IN, f'{ts}_{safe}.wav')
                                    
                                    start_recording(state.rec_path)
                                    state.in_call = True
                                    state.call_start = datetime.now()
                                    play_greeting_async()
                                    log(f"通话已开始")
                                    
                                    # 写入通话开始事件
                                    write_event('call_start', {
                                        'caller': state.caller,
                                        'contact_name': contact['name'] if contact else None,
                                        'rec_path': state.rec_path,
                                        'start_time': state.call_start.isoformat()
                                    })
                                else:
                                    log("[接听] 失败")
                                
                                state.ringing = False
                                state.ring_count = 0
                                state.caller = None
                    
                    # ── 通话结束 ──
                    if state.in_call:
                        if ('NO CARRIER' in buffer or 'VOICE CALL: END' in buffer):
                            duration = (datetime.now() - state.call_start).seconds
                            log(f"📞 通话结束: {state.caller} {duration}s")
                            stop_recording()
                            
                            # 写入事件，由 processor 处理
                            write_event('call_end', {
                                'caller': state.caller,
                                'duration': duration,
                                'rec_path': state.rec_path,
                                'start_time': state.call_start.isoformat(),
                                'end_time': datetime.now().isoformat()
                            })
                            
                            # 更新联系人统计
                            if state.caller:
                                update_call_stats(state.caller, duration)
                            
                            state.in_call = False
                            state.caller = None
                            state.rec_path = None
                            state.call_start = None
                    
                    # 短信
                    if '+CMT:' in buffer:
                        log("📩 短信（由sms-handler处理）")
                    
                    if len(buffer) > 2000:
                        buffer = buffer[-500:]
                
                time.sleep(0.05)
                
        except serial.SerialException as e:
            log(f"串口错误: {e}，重连...")
            stop_recording()
            port = find_port() or port
            time.sleep(3)
        except Exception as e:
            log(f"异常: {e}", exc_info=True)
            stop_recording()
            time.sleep(5)

if __name__ == '__main__':
    main()
```

### 3.2 后处理器

```python
# voice-system/src/processor.py
"""
后处理器 — 消费事件文件，执行 ASR → LLM → 推送 → DB
与 listener 完全解耦，异步处理
"""
import os, json, glob, time, sys, subprocess
from datetime import datetime

sys.path.insert(0, '/home/ai/.openclaw/workspace/voice-system/lib')
from contacts_db import identify_caller, insert_call, record_unknown
from transcribe import transcribe  # FunASR + Whisper
from summarizer import summarize     # LLM 摘要
from notifier import push_to_wechat  # 微信推送

EVENT_DIR = '/home/ai/.openclaw/workspace/voice-system/events/inbound'
LOG_FILE = '/home/ai/.openclaw/workspace/logs/4g-processor.log'

def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

def process_pending_events():
    events = sorted(glob.glob(os.path.join(EVENT_DIR, '*.pending')))
    # 也支持直接.json格式（新listener写入）
    events += sorted(glob.glob(os.path.join(EVENT_DIR, '*call_end.json')))
    
    for filepath in events:
        try:
            with open(filepath) as f:
                event = json.load(f)
            
            event_type = event.get('type', 'call_end')
            if event_type == 'call_end' or 'call_end' in filepath:
                handle_call_end(event, filepath)
        except Exception as e:
            log(f"[处理器] 事件处理失败 {filepath}: {e}")

def handle_call_end(event, filepath):
    caller = event['caller']
    duration = event['duration']
    rec_path = event['rec_path']
    
    log(f"[处理器] 处理通话结束: {caller} {duration}s")
    
    # 1. ASR 转写
    transcript = transcribe(rec_path)
    log(f"[处理器] 转写: {transcript[:80]}")
    
    # 2. LLM 摘要
    summary = summarize(transcript, caller, duration)
    
    # 3. 查找联系人
    contact = identify_caller(caller)
    display_name = contact['name'] if contact else caller
    
    # 4. 微信推送
    push_to_wechat(display_name, caller, duration, summary, transcript, rec_path)
    
    # 5. 写入数据库
    call_id = insert_call(
        direction='inbound',
        phone=caller,
        start_time=datetime.fromisoformat(event['start_time']),
        end_time=datetime.fromisoformat(event.get