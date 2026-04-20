# 智能语音通信系统 — 架构优化方案 v2.0

> 设计日期：2026-04-13
> 方案版本：v2.0（基于已实现能力的架构优化）
> 前置版本：v1.0（2026-04-10，基于 FreeSWITCH 的重型架构）

---

## 一、现状评估：已完成什么

### ✅ 已实现并稳定运行

| 功能 | 实现方式 | 状态 |
|------|---------|------|
| 4G模块基础通信 | AT指令（`/dev/ttyUSB2`） | ✅ 已验证 |
| VoLTE语音通话 | `ATD<号码>;` 拨号 + `ATA` 接听 | ✅ 已打通10086 |
| 来电自动监听 | `4g-call-listener.py`（PM2守护） | ✅ 在线运行 |
| 来电自动接听 | `ATA` 自动应答 | ✅ 已实现 |
| 短信接收+PDU解码 | `4g-sms-listener.py`（PM2守护） | ✅ 在线运行 |
| 短信发送（英文） | `4g-sms` 脚本 | ✅ 已验证 |
| 通话状态监控 | `AT+CLCC` + URC事件解析 | ✅ 已实现 |
| PM2服务管理 | `4g-call-listener` + `4g-sms-listener` | ✅ 双守护 |

### ⚠️ 已知限制

| 限制 | 影响 | 严重程度 |
|------|------|---------|
| 通话音频无法直接录 | A7670G走VoLTE语音承载，音频不经过Linux ALSA | 🔴 核心阻碍 |
| 中文短信发送失败 | 文本模式不支持UTF-8，PDU模式固件有bug | 🟡 重要 |
| 模块存储访问受限 | `AT+CREC`可录音到模块内部`c:/`，但难以提取文件 | 🟡 重要 |
| URC串口干扰 | 网络主动上报（`+CGEV`等）污染缓冲区 | 🟢 已缓解 |

### 🔴 核心问题：通话录音

v1 方案假设 FreeSWITCH 能处理 SIP RTP 流来录音。**现实是：A7670G 的 VoLTE 通话不经过 SIP/RTP 到达 Linux 系统**，音频走的是模块内部 IMS 语音承载。这意味着：

- ❌ FreeSWITCH 无法获取 RTP 流（模块不走 SIP 到主机）
- ❌ `arecord` 无法捕获通话音频（无 ALSA 音频设备）
- ❌ `AT+CREC` 录音走模块麦克风，录制的是"环境音"而非"通话双方音频"
- ⚠️ 音频输出接口（PH2.0）接喇叭/功放，理论上可通过硬件环回录制，但需要额外硬件

**这个限制直接改变了整个架构方向。**

---

## 二、架构调整：保留/升级/放弃

### 🟢 保留（直接沿用现有实现）

| 功能 | 理由 |
|------|------|
| AT指令直接控制通话 | 已经验证可用，无需 FreeSWITCH |
| PM2守护进程 | 稳定可靠，`pyserial` 串口监听已跑通 |
| PDU短信解码 | `4g-sms-listener.py` 已支持中文解码 |
| OpenClaw微信推送 | 已有通道，无需额外配置 |
| LLM摘要整理 | 对话模型可直接处理文本，无需改动 |

### 🟡 升级（需要改进）

| 功能 | v1方案 | v2方案 | 理由 |
|------|--------|--------|------|
| 通话录音 | FreeSWITCH RTP录制 | 硬件环回 / 模块录音提取 / TTS外呼录音优先 | A7670G不走SIP |
| TTS外呼 | Edge-TTS + FS播放 | Edge-TTS + 模块播放（`AT+CCMXPLAY`）| 直接利用模块能力 |
| 中文短信 | 未处理 | PDU编码发送脚本 | 已有解码能力，需补充发送 |
| 数据库 | PostgreSQL | SQLite | 单机单人用，SQLite够用且零运维 |

### 🔴 放弃（不再需要）

| 功能 | 放弃原因 |
|------|---------|
| **FreeSWITCH** | 模块不走SIP到主机，FS完全无用武之地 |
| **Asterisk** | 同上，过度工程 |
| **Kamailio** | 纯SIP代理，不解决我们的问题 |
| **linphone/baresip** | 需要SIP服务器，而我们直接用AT |
| **PostgreSQL** | 单人单服务，SQLite足够了 |
| **IVR多级菜单** | 个人使用场景不需要 |
| **多语言实时翻译** | 后期可选，当前非刚需 |
| **批量外呼任务** | 个人场景，最多定时提醒 |
| **情感分析** | LLM摘要中顺带标注即可，无需独立模块 |
| **通话过程实时监控/插话** | 需要双向音频流，当前架构不支持 |

---

## 三、简化后的架构

```
┌─────────────────────────────────────────────────────────────┐
│                    A7670G 4G模块（/dev/ttyUSB2）               │
│   AT指令: 拨号/接听/挂断/短信/录音/播放                          │
│   URC事件: RING / VOICE CALL: BEGIN/END / +CMT               │
└─────────────────────────┬───────────────────────────────────┘
                          │ pyserial（串口通信）
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Python 守护进程（PM2管理）                      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ call_monitor │  │ sms_monitor  │  │ outbound_manager │  │
│  │ (来电监听)    │  │ (短信监听)    │  │ (外呼管理)        │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         ▼                 ▼                    ▼            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              voice_orchestrator.py                    │  │
│  │   事件路由 | 状态管理 | 日志记录 | 数据库操作           │  │
│  └──────────────────────┬───────────────────────────────┘  │
└─────────────────────────┬──────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Edge-TTS    │  │   Whisper    │  │   LLM API    │
│  (TTS合成)    │  │  (语音转写)   │  │  (摘要整理)   │
│  本地免费     │  │  turbo模型   │  │  Qwen-max    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                  │
       ▼                 ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw 推送层                            │
│   微信通知 | 邮件通知 | 语音回复                               │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
               ┌──────────────────┐
               │  SQLite 数据库     │
               │  calls.db         │
               │  ─────────────    │
               │  calls            │
               │  sms              │
               │  contacts         │
               │  tasks            │
               └──────────────────┘
```

**关键变化：去掉了 FreeSWITCH，Python 守护进程直接通过 AT 指令控制模块。**

---

## 四、通话录音的可行方案

这是整个系统的核心难点。以下是三种可行方案，按推荐度排序：

### 方案A：硬件环回录制 ⭐推荐

**原理**：A7670G 有音频输出接口（PH2.0，接8Ω喇叭），用一根音频线将输出接入主机的麦克风输入口（Line-in），通话时对方声音从模块输出 → 进入主机 → `arecord` 录制。

```
A7670G Audio OUT ──[音频线]──→ 主机 Line-In ──→ arecord ──→ WAV文件
```

**优点**：
- 能录到对方声音（清晰）
- 硬件方案，不依赖模块固件
- 成本约 ¥5（3.5mm 音频线）

**缺点**：
- 只能录对方声音，录不到自己的声音（除非用 PulseAudio loopback）
- 需要物理接线
- 自己的声音可通过系统音频回环（`pacmd load-module module-loopback`）合并

**实施步骤**：
```bash
# 1. 确认音频输入设备
arecord -l

# 2. 录制测试
arecord -D plughw:1,0 -f S16_LE -r 8000 -c 1 -d 60 test.wav

# 3. 通话时后台录制
arecord -D plughw:1,0 -f S16_LE -r 8000 -c 1 call_recording.wav &
# ... 通话 ...
kill %1  # 停止录制
```

### 方案B：模块本地录音 + 提取

**原理**：使用 `AT+CREC=1,"c:/rec.wav"` 录音到模块内部存储，通话结束后提取文件。

**已知命令**：
```bash
AT+CREC=1,"c:/rec.wav"   # 开始录音
AT+CREC=0                 # 停止录音
```

**未解决问题**：录音文件存储在模块内部 Flash，需要通过以下方式提取：
1. **FTP提取**：模块支持 FTP 客户端（`AT+FTPPUT`），可主动推送到 FTP 服务器
2. **AT命令读取**：部分 SIMCOM 模块支持 `AT+CFTR` 等文件读取命令（需确认A7670G固件是否支持）
3. **USB大容量存储**：模块不支持 UMS 模式

**优点**：
- 录制的是模块音频通道（可能包含双方声音）
- 不需要额外硬件

**缺点**：
- 文件提取路径不明确，需要测试
- 模块存储空间有限
- 录音质量取决于模块ADC

### 方案C：麦克风环境录制（兜底）

**原理**：用主机的麦克风录下 A7670G 喇叭播放的声音。

**缺点**：
- 质量差（环境噪音、回声）
- 录不到自己的声音
- 只适合作为临时方案

---

## 五、TTS外呼方案（已具备条件）

### 工作流程

```
用户输入文字 → Edge-TTS合成MP3 → 转为模块支持的格式 → 播放/外呼
```

### 关键发现

A7670G 支持 `AT+CCMXPLAY` 播放本地音频文件：
```bash
AT+CCMXPLAY="c:/rec.mp3",0,0    # 播放模块内部的MP3
```

### 实施路径

**路径1（推荐）：模块播放**
1. 用 Edge-TTS 合成 MP3
2. 通过 FTP 或 AT 文件上传命令将 MP3 发送到模块 `c:/` 目录
3. `AT+CCMXPLAY` 播放给对方听

**路径2（备用）：主机播放**
1. Edge-TTS 合成 MP3 → 转为 WAV
2. 通过主机音频输出 → 音频线 → 模块麦克风输入
3. 通话中播放

**路径1的上传问题**：SIMCOM A76XX 系列支持通过 AT 命令上传文件到模块 Flash：
```bash
AT+FTPPUT...   # FTP方式（需FTP服务器）
AT+CFTR        # 文件传输（需确认支持）
```

如果文件上传不可行，**路径2是更务实的选择**。

---

## 六、数据库设计（SQLite 版）

从 PostgreSQL 改为 SQLite，原因：
- 单人单服务，不需要并发
- SQLite 零配置、零运维
- Python 内置 `sqlite3`，无需额外依赖
- 备份只需复制 `.db` 文件

```sql
-- 通话记录
CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller TEXT,              -- 主叫号码
    callee TEXT,              -- 被叫号码
    direction TEXT,           -- 'inbound' / 'outbound'
    status TEXT,              -- 'answered' / 'missed' / 'voicemail'
    duration INTEGER,         -- 通话秒数
    recording_path TEXT,      -- 录音文件路径
    transcript TEXT,          -- Whisper转写
    summary TEXT,             -- LLM摘要
    tags TEXT,                -- JSON数组标签
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 短信记录
CREATE TABLE IF NOT EXISTS sms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number TEXT,
    to_number TEXT,
    direction TEXT,
    content TEXT,
    encoding TEXT,            -- '7-bit' / 'UCS-2' / 'PDU'
    status TEXT DEFAULT 'received',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 联系人
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE,
    remark TEXT,
    is_blacklist INTEGER DEFAULT 0,
    is_whitelist INTEGER DEFAULT 0,
    tags TEXT,                -- JSON数组
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 定时任务
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT,           -- 'call' / 'sms'
    target TEXT,              -- 目标号码
    content TEXT,             -- 内容
    scheduled_at TIMESTAMP,
    status TEXT DEFAULT 'pending',
    result TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 七、分阶段实施计划

### 第一阶段：录音能力 ⭐ 最优先

**目标**：实现通话录音，这是后续所有AI功能的前提。

| 任务 | 状态 | 优先级 |
|------|------|--------|
| 测试硬件环回录制（方案A） | 待测 | P0 |
| 确认 arecord 能录到对方声音 | 待测 | P0 |
| 通话开始/结束自动触发录制 | 待开发 | P0 |
| 合并双方音频（loopback） | 待开发 | P1 |
| 测试 `AT+CREC` 录音 + 文件提取 | 待测 | P1 |

**里程碑**：一次完整通话 → 两端都能录到 → 得到WAV文件

### 第二阶段：语音转写 + 推送

**目标**：录音 → 转写 → 摘要 → 推送

| 任务 | 状态 | 优先级 |
|------|------|--------|
| Whisper 本地转写脚本 | 待开发 | P0 |
| LLM摘要生成脚本 | 待开发 | P0 |
| OpenClaw微信推送集成 | 待开发 | P0 |
| SQLite数据库集成 | 待开发 | P1 |
| 联系人匹配 + 来电备注 | 待开发 | P1 |

**里程碑**：来电结束后10秒内，微信收到"张三打来，说了xxx"

### 第三阶段：TTS外呼

**目标**：输入文字 → 合成语音 → 拨打电话 → 播放给对方

| 任务 | 状态 | 优先级 |
|------|------|--------|
| Edge-TTS 合成脚本 | 待开发 | P0 |
| 音频格式转换（MP3→WAV/PCM） | 待开发 | P0 |
| 外呼 + 播放方案验证 | 待测试 | P0 |
| 中文短信发送（PDU编码） | 待开发 | P1 |
| 外呼记录存档 | 待开发 | P1 |

**里程碑**：输入"你好，明天开会" → 自动拨打138xxxx → 对方听到语音

### 第四阶段：定时任务 + 自动化

| 任务 | 状态 | 优先级 |
|------|------|--------|
| 定时任务调度器 | 待开发 | P0 |
| SQLite `tasks` 表管理 | 待开发 | P0 |
| 失败重试机制 | 待开发 | P1 |
| 黑名单/白名单 | 待开发 | P2 |

**里程碑**：设置"明早8点打电话提醒起床" → 到点自动拨打

---

## 八、目录结构

```
/home/ai/voice-system/
├── data/
│   └── calls.db              # SQLite数据库
├── recordings/               # 通话录音
│   ├── inbound/              # 来电录音
│   └── outbound/             # 外呼录音
├── scripts/                  # 已有脚本（保留）
│   ├── 4g-call               # 手动拨号
│   ├── 4g-sms                # 手动发短信
│   ├── 4g-answer             # 手动接听
│   ├── 4g-call-listener.py   # PM2来电监听
│   └── 4g-sms-listener.py    # PM2短信监听
├── src/                      # 新增Python模块
│   ├── orchestrator.py       # 主控制器（事件路由+状态管理）
│   ├── recorder.py           # 录音管理（arecord封装）
│   ├── transcribe.py         # Whisper转写
│   ├── summarizer.py         # LLM摘要生成
│   ├── tts.py                # Edge-TTS合成
│   ├── outbound.py           # 外呼管理
│   ├── notifier.py           # OpenClaw推送
│   ├── scheduler.py          # 定时任务
│   ├── db.py                 # SQLite操作
│   └── contacts.py           # 联系人管理
├── config/
│   └── settings.yaml         # 配置文件
├── requirements.txt
└── README.md
```

---

## 九、技术选型（最终版）

| 模块 | 选择 | 备选 | 理由 |
|------|------|------|------|
| 通话控制 | AT指令直控 | ~~FreeSWITCH~~ | 已验证可用 |
| 串口通信 | pyserial | — | 稳定，现有代码基于此 |
| 进程管理 | PM2 | systemd | 已有PM2在运行 |
| 录音 | arecord + ALSA | ~~RTP录制~~ | 硬件环回方案 |
| ASR | Whisper turbo | faster-whisper | 速度优先 |
| TTS | Edge-TTS | Youdao TTS | 免费，中文质量好 |
| LLM | Qwen-max (通义) | DeepSeek-V3 | 已有配置 |
| 数据库 | SQLite | ~~PostgreSQL~~ | 单机零运维 |
| 推送 | OpenClaw微信 | 邮件SMTP | 最快触达 |
| 调度 | APScheduler | cron | Python内集成 |

---

## 十、参考项目

### 4G模块 + Linux
- **[SIMCOM AT Command Manual](https://www.simcom.com/product/A7670X.html)** — A76XX系列AT指令手册（V2.03）
- **[SIMCOM Audio Application Note](https://www.simcom.com/product/A7670X.html)** — A76XX音频应用文档（V1.03），含 `AT+CREC`/`AT+CCMXPLAY` 说明
- **[DFRobot A7670G Wiki](https://wiki.dfrobot.com.cn/_SKU_TEL0163_A7670G_CAT1_4G_通信模块)** — 开发板使用指南，含电话/短信/MQTT示例
- **[Adrianotiger/simcomtester](https://github.com/Adrianotiger/simcomtester)** — Web端SIMCOM模块测试工具
- **[hbjorgo/GsmApi](https://github.com/hbjorgo/GsmApi)** — GSM功能REST API封装（C#）
- **[embedded4ever/Duru](https://github.com/embedded4ever/Duru)** — 平台无关的GSM应用框架（C）

### SIP/VoIP（参考，当前不用）
- **[pjsip/pjproject](https://github.com/pjsip/pjproject)** — 轻量级SIP/多媒体库，C语言，Python绑定
- **[FreeSWITCH](https://github.com/signalwire/freeswitch)** — 电信级软交换（v1方案，现放弃）
- **[Asterisk](https://github.com/asterisk/asterisk)** — 传统PBX（v1方案，现放弃）

### 语音转写
- **[openai/whisper](https://github.com/openai/whisper)** — OpenAI Whisper，支持turbo模型
- **[SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)** — Whisper加速版，CTranslate2后端，速度提升4倍

### TTS
- **[rany2/edge-tts](https://github.com/rany2/edge-tts)** — 免费Edge TTS，中文语音质量优秀
- **[openai/tts](https://platform.openai.com/docs/guides/text-to-speech)** — OpenAI TTS（付费，高质量）

### 开源语音助手参考
- **[rhasspy/rhasspy](https://github.com/rhasspy/rhasspy)** — 离线语音助手框架（架构参考）
- **[openvoice](https://github.com/myshell-ai/OpenVoice)** — 即时语音克隆（可选音色定制）

---

## 十一、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 硬件环回音质差 | 转写准确率下降 | 用8000Hz单声道WAV，Whisper对电话音质已优化 |
| 模块固件升级导致AT命令变化 | 通话/短信功能异常 | 每次固件升级后回归测试 |
| SIM卡欠费/信号差 | 通话失败 | 监控 `AT+CSQ` 信号强度，低信号时告警 |
| Whisper大模型占GPU | 影响其他服务 | 用turbo模型（~6GB VRAM），或CPU推理 |
| 中文短信发送始终不可行 | 无法发中文短信 | 外呼TTS替代，或换SIM7600模块 |

---

## 十二、成本估算

| 项目 | 成本 | 说明 |
|------|------|------|
| A7670G模块 | 已购 | DFRobot TEL0163 |
| 音频线（环回） | ¥5 | 3.5mm 公对公音频线 |
| SIM卡流量 | ~¥10/月 | 语音+短信套餐 |
| Edge-TTS | 免费 | Microsoft服务 |
| Whisper | 免费 | 本地推理 |
| Qwen-max | 按量 | 通义千问API |
| **总计** | **~¥20/月（不含模块）** | |

---

## 十三、第一步行动

**当前最需要验证的一件事：能否录到通话音频？**

```bash
# 1. 检查音频输入设备
arecord -l

# 2. 接线：A7670G Audio OUT → 主机 Line-In

# 3. 测试录制（通话前启动）
arecord -D plughw:1,0 -f S16_LE -r 8000 -c 1 /tmp/test_call.wav

# 4. 用 4g-call 拨打10086测试

# 5. 播放验证
aplay /tmp/test_call.wav
```

确认能录音后，整个AI语音管线就能跑通。

**接线方案待确认**：A7670G 的 Audio OUT 是 PH2.0-2P 接口，需要 PH2.0转3.5mm 的线材或适配器。

---

---

## 十四、Voice Call AI（新增功能 v2.1）

> 2026-04-13 新增需求：打电话和 AI 实时语音对话
> 核心场景：你打电话给 AI → 实时交互 → 双向语音对话

### 目标与场景

| 场景 | 描述 |
|------|------|
| **来电 AI 对话** | 有人打你电话 → AI 接听 → 和 AI 实时聊天 → 挂断后微信收到对话摘要 |
| **主动呼叫 AI** | 你让系统打电话给某人 → 系统呼叫对方 → AI 接听 → 双方对话 |

**本质：** 实时双向语音对话，不是录音转写，是通话中 AI 边听边说。

### 核心挑战

**延迟是生命线。** 电话里不能等太久，否则像"断线了"。

全流程目标延迟：**< 5 秒**（从用户说完到 AI 开始说话）

```
用户说话
  ↓ VAD 检测 (~200ms)
  ↓ 增量转写 (~500ms-1s)
  ↓ LLM 生成回复 (~1-2s)
  ↓ TTS 合成 (~500ms-1s)
  ↓ 播放给用户
总计 ~3-5s（勉强可接受，越短越好）
```

### 两种实现方案

#### 方案 A：简化版（先跑通）⭐

**思路：** 一问一答，用户说完 → AI 回复 → 循环。无法打断，无法同时说话。

```
通话建立
  → AI 说"你好，我是玄枢，请讲"
  → 用户说话
  → VAD 检测用户停止
  → Whisper 转写
  → LLM 生成回复
  → Edge-TTS 合成
  → 播放给用户
  → 循环...
```

**适合：** 固定问答场景，如电话客服、语音问答

#### 方案 B：理想版（真正实时）

**思路：** 实时 VAD + 流式 ASR + 边听边生成，用户可随时打断 AI 说话。

```
持续音频流
  ↓ Silero VAD 实时检测（谁在说话）
  ↓ 增量流式 Whisper（不等说完就开始转写）
  ↓ LLM 流式输出（第一个 token 就开始）
  ↓ Edge-TTS 边生成边播放（流式）
  ↓ 用户可随时说"停"打断 AI
```

**需要：更低的延迟 + 音频捕获更稳定**

### 关键障碍：音频流捕获

**A7670G 的音频不过 Linux**——这是最大问题。

电话打进来，声音在模块里处理，不经过电脑的 ALSA。要实现实时对话，必须先解决音频流捕获：

| 方式 | 难度 | 说明 |
|------|------|------|
| **硬件环回**（音频线）| ⭐ 低 | 模块 Audio OUT → 电脑 Line-in（最可行）|
| USB 音频模式 | ⭐⭐ 中 | 某些 4G 模块支持 USB 声卡模式（A7670G 待确认）|
| 蓝牙耳机 | ⭐⭐ 中 | 手机连电脑，手机接电话（需另备手机）|
| SIP 分机注册 | ⭐⭐⭐ 高 | 模块注册为 SIP 分机到 FS（复杂，不推荐）|

**结论：** 先走硬件环回路线，验证可行性后再优化。

### 技术栈

| 模块 | 选择 | 理由 |
|------|------|------|
| VAD（语音活动检测）| **Silero VAD** | 免费、本地、精度高，支持 Python |
| ASR（实时转写）| **Faster-Whisper**（流式）或 **SenseVoice** | 增量输出，低延迟 |
| LLM | **Qwen-max**（流式输出）| 支持流式，边生成边返回 |
| TTS | **Edge-TTS**（流式）| 已集成，支持流式合成 |
| 音频捕获 | **arecord + ALSA**（硬件环回）| 现有方案 |
| 打断机制 | **Ctrl+C 风格**（Kill + 重新开始）| 简化实现 |

### 数据流（简化版）

```
                     ┌──────────────────────────────────────┐
                     │           Python 通话控制器              │
                     │  orchestrator_voice.py                │
                     └──────────────────────────────────────┘
                                         │
          ┌───────────────────────────────┼───────────────────────────────┐
          ↓                               ↓                               ↓
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│  arecord 录音    │          │   LLM 推理      │          │  Edge-TTS 合成  │
│ (Line-in 输入)   │          │  (Qwen-max)    │          │  (流式输出)     │
└────────┬────────┘          └────────┬────────┘          └────────┬────────┘
         │                            │                            │
         ↓                            ↓                            ↓
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│ Silero VAD      │          │  对话历史       │          │ aplay 播放      │
│ (检测说话开始/结束)│  →     │  (上下文管理)   │   →     │ (对方听到AI声音) │
└────────┬────────┘          └─────────────────┘          └─────────────────┘
         │
         ↓
┌─────────────────┐
│ Faster-Whisper  │
│ (增量转写)       │
└────────┬────────┘
         │
         ↓
  用户说的文字 → LLM → AI 回复文字 → TTS → 播放
```

### 实施步骤

#### Phase 1：音频捕获验证（P0）
- [ ] 硬件环回接线测试
- [ ] `arecord` 确认能录到对方声音
- [ ] 验证延迟可接受（< 1s 采集延迟）

#### Phase 2：简化版 Voice Call（A1）
- [ ] Silero VAD 集成（检测用户说话开始/结束）
- [ ] Whisper 增量转写
- [ ] LLM 对话（带上下文）
- [ ] Edge-TTS 合成 + 播放
- [ ] PM2 守护进程整合

#### Phase 3：打断机制（A2）
- [ ] 用户说"停"关键字检测
- [ ] 停止当前 TTS 播放
- [ ] 重新开始监听

#### Phase 4：流式优化（B）
- [ ] LLM 流式输出（第一个 token 就开始）
- [ ] TTS 边生成边播放（不等完整句子）
- [ ] 全流程延迟压测

#### Phase 5：来电接听（B）
- [ ] 来电自动触发 Voice Call AI
- [ ] AI 主动接听并打招呼
- [ ] 通话结束自动挂断 + 发送摘要

### 与现有 v2 功能的关系

| 功能 | Voice Call AI | v2 录音转写 |
|------|-------------|------------|
| 时机 | 通话中实时 | 通话后处理 |
| 音频 | 实时流 | 完整录音文件 |
| AI 回复 | 实时语音播报 | 仅文字摘要 |
| 打断支持 | 需要 | 不需要 |
| 延迟要求 | < 5s | 无所谓 |
| **共平台** | ✅ 共享 arecord / Whisper / TTS / LLM 组件 |

**结论：** Voice Call AI 和 v2 录音转写共享基础组件（arecord + Whisper + TTS + LLM），可以并行开发。

### 新增文件

```
voice-system/src/
├── orchestrator_voice.py   # Voice Call 主控制器
├── vad.py                  # Silero VAD 封装
├── streaming_asr.py        # 流式 Whisper
├── streaming_tts.py        # Edge-TTS 流式合成
├── audio_device.py         # 音频设备管理
└── voice_call_manager.py   # PM2 守护入口
```

---

*本方案基于实际已验证的A7670G能力编写，所有架构调整均围绕"去掉不需要的、强化已验证的"原则。*
*版本：v2.1 | 日期：2026-04-13 | 新增：Voice Call AI 功能*
