# 4G 语音系统方案 — 玄枢版

> 日期：2026-04-14 04:30
> 核心命题：以通讯录为基石，基于现有能力构建完整方案

---

## 一、核心逻辑梳理

### 通讯录为什么是基石？

```
没有通讯录 → 来电只看到号码 → 无法做差异化处理 → 功能天花板
有了通讯录 → 来电匹配姓名/身份 → 差异化策略 → AI能力全面释放
```

**通讯录是整个系统的"身份锚点"。** 所有功能都依赖"知道来电/去电是谁"。

### 现有能力清单（实测可用）

| 能力 | 状态 | 文件/方式 |
|------|------|-----------|
| AT 指令控制通话 | ✅ 稳定 | `4g-call`, `4g-answer` |
| 来电监听+自动接听 | ✅ v7 | `4g-combined-listener.py` |
| 短信接收+PDU解码 | ✅ | `4g-sms-listener.py` |
| by-id 端口发现 | ✅ 稳定 | `find_at_port()` |
| 硬件环回录音 | ✅ 23条 | `arecord -D plughw:1,0` |
| FunASR 转写 | ✅ 主力 | dashscope 1.25.14 |
| Whisper 转写 | ✅ 备用 | `whisper` CLI |
| LLM 摘要 | ✅ | Qwen-max |
| 微信推送 | ✅ | OpenClaw message |
| Edge-TTS | ⚠️ CLI可用 | `edge-tts`，未集成 |
| 提示音播放 | ✅ | ffmpeg → ALSA |
| 残留通话检查 | ✅ | AT+CLCC |

### 明确不可用的

| 能力 | 原因 |
|------|------|
| FreeSWITCH/RTP录音 | A7670G VoLTE 不走 SIP |
| AT+CCMXPLAY 播放给对方 | 文件上传到模块不可行 |
| 中文短信发送 | PDU 编码固件有 bug |
| 模块内部录音提取 | `AT+CREC` 文件无法提取 |

---

## 二、通讯录设计

### 数据模型（SQLite）

```sql
CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,              -- 姓名/称呼
    phone TEXT UNIQUE NOT NULL,      -- 手机号（+86可省略）
    relation TEXT,                   -- 关系: family/friend/colleague/boss/service/unknown
    nickname TEXT,                   -- 玄枢称呼对方的名字
    priority INTEGER DEFAULT 0,      -- 优先级: 99=必须接听, 0=正常, -1=黑名单
    voice_profile TEXT,              -- 声纹特征（未来扩展）
    last_call_at TIMESTAMP,          -- 最后通话时间
    call_count INTEGER DEFAULT 0,    -- 累计通话次数
    notes TEXT,                      -- 备注
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 自动学习表：从未出现过的号码自动记录
CREATE TABLE unknown_callers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP,
    call_count INTEGER DEFAULT 1,
    labeled INTEGER DEFAULT 0        -- 是否已被用户标注
);

-- 通话记录（增强版）
CREATE TABLE calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER,              -- NULL = 未知号码
    phone TEXT,                      -- 号码（兜底）
    direction TEXT,                  -- inbound/outbound
    status TEXT,                     -- answered/missed/rejected/voicemail
    duration INTEGER,                -- 秒
    recording_path TEXT,
    transcript TEXT,
    summary TEXT,
    tags TEXT,                       -- JSON: ["urgent","family"]
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
);
```

### 通讯录的功能价值

| 功能 | 无通讯录 | 有通讯录 |
|------|---------|---------|
| 来电通知 | "139xxxx 打来" | "老妈打来电话" |
| 接听策略 | 一律接听 | 黑名单拒接，VIP秒接 |
| 提示音 | 通用提示音 | "您好，灵须子的助理玄枢" |
| 转写摘要 | "某人说..." | "老妈说周末回家吃饭" |
| 主动外呼 | 只能拨号码 | "给老妈打电话"→自动查号 |
| 未接回拨 | 无意义数字 | "有3个未接，分别是老妈/张三/快递" |
| 语音识别优化 | 通用模型 | 常用联系人名字优先识别 |

---

## 三、系统架构（基于现有能力）

```
┌─────────────────────────────────────────────────────────────────┐
│                     A7670G 4G 模块                               │
│   AT命令: 拨号/接听/挂断/短信 | URC: RING/CLIP/VOICE CALL        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ pyserial (by-id 固定路径)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              4g-combined-listener.py (PM2守护, v7)               │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ 来电监听    │  │ 短信监听    │  │ 外呼管理 │  │ 状态管理     │ │
│  │ RING→ATA   │  │ +CMT→解码  │  │ ATD      │  │ CLCC兜底    │ │
│  └─────┬──────┘  └─────┬──────┘  └────┬─────┘  └──────┬──────┘ │
│        │               │              │                │        │
│        ▼               ▼              ▼                ▼        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   通讯录查询层                             │  │
│  │   phone → contacts → name/relation/priority/strategy      │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                             │                                  │
│              ┌──────────────┼──────────────┐                   │
│              ▼              ▼              ▼                   │
│     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│     │ arecord录音  │ │ 提示音播放   │ │ 策略执行     │           │
│     │ plughw:1,0  │ │ ffmpeg→ALSA │ │ 黑白名单     │           │
│     └──────┬──────┘ └─────────────┘ └─────────────┘           │
│            │                                                   │
│            ▼                                                   │
└─────────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
     │ FunASR/     │ │  Edge-TTS   │ │  SQLite DB  │
     │ Whisper转写 │ │  (未集成)   │ │  contacts   │
     └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
            │               │               │
            ▼               ▼               ▼
     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
     │ LLM 摘要    │ │  aplay播放  │ │  通话存档    │
     │ Qwen-max    │ │ (未集成)    │ │  JSONL→SQLite│
     └──────┬──────┘ └─────────────┘ └─────────────┘
            │
            ▼
     ┌─────────────┐
     │ 微信推送     │
     │ OpenClaw    │
     └─────────────┘
```

---

## 四、分阶段实施方案

### Phase 1：通讯录基础（1-2天）⭐ 最先做

| 任务 | 工作量 | 说明 |
|------|--------|------|
| SQLite 数据库初始化 | 30min | 创建 contacts/calls 表 |
| 通讯录 CRUD 脚本 | 2h | `contacts add/list/search/delete` |
| JSONL → SQLite 迁移 | 30min | 现有 calls.jsonl 导入 |
| 来电号码→姓名匹配逻辑 | 1h | listener.py 内集成 |
| 未知号码自动记录 | 30min | unknown_callers 表 |
| 推送文案改造 | 30min | "139xxxx" → "老妈" |

**交付**：来电微信推送显示姓名而非号码

### Phase 2：策略层（1天）

| 任务 | 工作量 | 说明 |
|------|--------|------|
| 黑白名单执行 | 1h | priority=-1 自动拒接 |
| VIP 优先接听 | 30min | priority=99 秒接 |
| 自定义提示音 | 1h | 按关系播放不同提示音 |
| 联系人通话统计 | 1h | last_call_at, call_count |
| 短信号码匹配 | 30min | 短信也显示姓名 |

**交付**：差异化接听策略 + 个性化提示音

### Phase 3：TTS 外呼（2-3天）

| 任务 | 工作量 | 说明 |
|------|--------|------|
| Edge-TTS 集成到系统 | 2h | Python 封装，非 CLI |
| 通话录音+arecord | 已有 | 复用现有代码 |
| 外呼脚本改造 | 2h | `4g-call` → 支持TTS播放 |
| "给XX打电话"自然语言 | 2h | 通讯录查号 → 自动拨打 |
| 未接来电回拨提醒 | 1h | cron 检查 missed calls |

**交付**：自然语言拨号 + TTS 语音播报

### Phase 4：Voice Call AI（3-5天）

| 任务 | 工作量 | 说明 |
|------|--------|------|
| Silero VAD 安装集成 | 2h | pip install + 封装 |
| 实时转写管线 | 3h | VAD → Whisper → LLM |
| 流式 TTS 播放 | 2h | Edge-TTS 流式输出 |
| 打断机制 | 2h | 用户说"停"检测 |
| PM2 守护整合 | 1h | voice_call_manager |

**交付**：来电后与 AI 实时语音对话

---

## 五、风险点及根本解决方案

### 🔴 风险1：只能录到对方声音，录不到自己

**现状**：硬件环回录制的是 A7670G Audio OUT → 主机 Line-In，只有对方声音。

**影响**：转写不完整，AI 不知道主人说了什么。

**根本解决**：
```
方案A（推荐）：系统音频回环
- `pactl load-module module-loopback` 创建系统音频回环
- 同时录制 Line-In（对方）和系统回环（自己）
- 用 `ffmpeg` 合并双声道：左=对方，右=自己
- 转写时双声道一起处理

方案B（备用）：双路录制
- arecord -D plughw:1,0 录对方（Line-In）
- arecord -D pulse 录自己（系统麦克风）
- 后期合并

方案C（妥协）：只录对方
- 转写只包含对方说的话
- 摘要里标注"对方说..."
- 对 Voice Call AI 不可行（需要双向）
```

**推荐：方案A，成本0元，纯软件。**

### 🔴 风险2：TTS 外呼的音频无法送入 4G 模块

**现状**：`AT+CCMXPLAY` 需要文件在模块内部存储，文件上传机制不可用。

**影响**：外呼后无法播放 TTS 语音给对方。

**根本解决**：
```
方案A（推荐）：主机播放 → 模块麦克风输入
- Edge-TTS 合成 → aplay 播放到主机音频输出
- 主机音频输出（3.5mm耳机孔）→ 音频线 → 模块麦克风输入
- 这样对方听到的是主机播放的 TTS
- 已在"硬件环回"方向上复用同一根音频线
- 需要一根 3.5mm 公对公音频线（¥5）

方案B（测试）：模块扬声器 → 模块麦克风物理回环
- 在模块端，用物理方式让扬声器声音进入麦克风
- 不靠谱，回声/反馈严重

方案C（放弃外呼TTS）：只做来电AI
- 不主动外呼播放TTS
- Voice Call AI 仍可做（来电后AI接听对话）
```

**推荐：方案A，和录音环回共用音频线，一根线双向传输。**

### 🟡 风险3：FunASR 依赖网络

**现状**：FunASR 用 dashscope API，需要互联网连接。

**影响**：断网时无法转写。

**根本解决**：
```
- 已有 Whisper 本地回退（已安装）
- 修改 transcribe() 函数：FunASR 失败 → 自动降级 Whisper
- Whisper turbo 本地推理，完全离线
- 这是已实现的策略，只需确保稳定
```

### 🟡 风险4：SQLite 并发写入问题

**现状**：PM2 守护进程持续运行，来电/短信可能并发写入。

**影响**：数据库锁。

**根本解决**：
```
- SQLite WAL 模式（Write-Ahead Logging）
- `PRAGMA journal_mode=WAL;` 允许读写并发
- 单进程写入，读不阻塞
- Python sqlite3 默认支持 WAL
```

### 🟡 风险5：通讯录号码格式匹配

**现状**：CLIP 返回的号码格式可能是 `13912345678`、`+8613912345678`、`02112345678`。

**影响**：匹配不上通讯录里的号码。

**根本解决**：
```python
def normalize_phone(phone):
    """统一号码格式"""
    if not phone: return None
    phone = re.sub(r'[^\d+]', '', phone)  # 只保留数字和+
    phone = phone.lstrip('+')              # 去+
    if phone.startswith('86') and len(phone) == 13:
        phone = phone[2:]                  # 去国际码
    if phone.startswith('0') and len(phone) == 11:
        phone = phone[1:]                  # 去长途前缀
    return phone
```

### 🟡 风险6：arecord 录音电平/杂音

**现状**：4月13日实测发现录音电平偏高（12% clipping），有电流声。

**影响**：转写准确率下降。

**根本解决**：
```
- 音频隔离器（已购，在路上）→ 解决电流声/地环路
- arecord 参数调优：`-v` 显示电平，调整 `-D` 设备增益
- 录音后处理：`sox` 降噪 + 标准化音量
- 短期：arecord 用 16kHz 8bit 降低数据量，Whisper 自适应
```

---

## 六、通讯录数据结构详细设计

### 快速录入命令

```bash
# 添加联系人
contacts add --name "老妈" --phone "13980819087" --relation "family" --priority 99

# 查询
contacts search "老妈"
contacts list --relation family

# 标注未知号码
contacts label --phone "13812345678" --name "张师傅" --relation "colleague"

# 黑名单
contacts block --phone "13700000000"
```

### 自动学习机制

```
未知号码来电 → unknown_callers 记录
    ↓
同号码来电3次以上 → 微信推送："号码 138xxxx 已来电3次，要加入通讯录吗？"
    ↓
用户回复"是" → 自动创建联系人（默认关系=service）
    ↓
用户回复"是，这是张师傅" → 创建联系人（name=张师傅, relation=colleague）
```

### 与现有数据的集成

```
calls.jsonl 已有 23 条录音记录
→ 迁移到 SQLite calls 表
→ 提取所有 unique phone
→ 提示用户为高频来电号码创建联系人
→ 已知号码：18180819087, 13980819087, 19180805647
```

---

## 七、推荐执行顺序

```
今天：
  1. 创建 SQLite 数据库 + contacts/calls 表
  2. JSONL → SQLite 迁移
  3. 来电号码→姓名匹配逻辑集成到 listener.py
  4. 推送文案从号码改为姓名

明天：
  5. 黑白名单 + VIP 策略
  6. 通讯录 CRUD 脚本
  7. 自动学习未知号码

后天：
  8. 系统音频回环（双向录音）
  9. TTS 外呼音频线方案验证
 10. Edge-TTS 集成

Phase 4（待定）：
 11. Voice Call AI 实时对话
```

---

_方案结束。待与 Claude Opus 方案综合对比。_
