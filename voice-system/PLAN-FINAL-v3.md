# 4G 语音系统 + 通讯录 — 综合方案 v3.0

> 日期：2026-04-14
> 来源：玄枢 + Claude Opus 双方案综合
> 状态：待审批执行

---

## 一、现状盘点

### 1.1 硬件环境

| 项目 | 规格 |
|------|------|
| 模块 | SIMCOM A7670G（VoLTE） |
| 接口 | USB AT 命令（by-id 固定路径） |
| 音频口 | PH2.0 音频输出（接 8Ω 喇叭） |
| 限制 | 不支持 USB 声卡 / 不走 SIP/RTP / 文件无法上传到模块 |

### 1.2 已实现能力（12项）

| # | 能力 | 状态 | 代码位置 |
|---|------|------|---------|
| 1 | AT 指令拨号/接听/挂断/短信 | ✅ 稳定 | scripts/4g-call, 4g-answer |
| 2 | 来电监听 + 自动接听（ATA 异步） | ✅ v7 | scripts/4g-combined-listener.py |
| 3 | 短信接收 + PDU 中文解码 | ✅ | scripts/4g-sms-listener.py |
| 4 | by-id 端口动态发现 | ✅ 稳定 | find_at_port() |
| 5 | 硬件环回录音（Line-In → arecord） | ✅ 23条 | arecord -D plughw:1,0 |
| 6 | FunASR 转写（dashscope API） | ✅ 主力 | dashscope 1.25.14 |
| 7 | Whisper 本地转写 | ✅ 备用 | whisper CLI |
| 8 | LLM 摘要生成 | ✅ | Qwen-max |
| 9 | 微信推送 | ✅ | OpenClaw message |
| 10 | Edge-TTS | ⚠️ CLI 可用 | edge-tts，未集成 |
| 11 | 提示音异步播放 | ✅ | ffmpeg → ALSA |
| 12 | 启动残留通话检查 | ✅ | AT+CLCC |

### 1.3 明确不可用（4项）

| 能力 | 原因 |
|------|------|
| FreeSWITCH / RTP 录音 | A7670G VoLTE 不走 SIP |
| AT+CCMXPLAY 播放给对方 | 文件无法上传到模块内部存储 |
| 中文短信发送 | PDU 编码固件有 bug |
| 模块内部录音提取 | AT+CREC 文件无法导出 |

### 1.4 已知问题

| # | 问题 | 严重程度 | 验证状态 |
|---|------|---------|---------|
| P1 | 来电只显示裸号码（"18180805797"），无法识别身份 | 🔴 核心 | 23条记录涉及5个号码，全部裸号 |
| P2 | 录音电平 12% clipping + 电流声 | 🔴 核心 | 4月13日实测确认 |
| P3 | 只能录到对方声音，录不到自己 | 🔴 核心 | 硬件环回物理限制 |
| P4 | ASR 转写同步阻塞监听（FunASR 耗时 20-60 秒） | 🔴 架构 | 代码审查确认 |
| P5 | TTS 外呼音频无法送入模块 | 🔴 功能 | 多次测试确认 |
| P6 | 通话记录用 JSONL，无法查询聚合 | 🟡 数据 | 需 grep 分析 |
| P7 | API Key 硬编码在多个脚本中 | 🟡 安全 | 代码审查确认 |
| P8 | 录音文件无清理策略 | 🟢 运维 | 长期会占满存储 |

---

## 二、核心逻辑：为什么通讯录是基石

```
┌──────────────────────────────────────────────────────┐
│                  通讯录 = 身份锚点                      │
├──────────────────────────────────────────────────────┤
│  没有通讯录                                            │
│    → 来电只看到号码                                     │
│    → 无法做差异化处理                                   │
│    → 推送信息价值几乎为零                               │
│    → 所有 AI 功能天花板                                 │
│                                                        │
│  有了通讯录                                            │
│    → 来电匹配姓名/身份                                  │
│    → 黑白名单 / VIP 策略                               │
│    → 推送显示"老妈打来"而非"139xxxx打来"                 │
│    → "给老妈打电话"自然语言拨号                          │
│    → 按人聚合通话历史                                   │
│    → 未知号码自动学习                                   │
└──────────────────────────────────────────────────────┘
```

---

## 三、数据模型设计

### 3.1 contacts 表

```sql
CREATE TABLE IF NOT EXISTS contacts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,              -- 姓名/称呼（必填）
    phone            TEXT UNIQUE NOT NULL,       -- 手机号
    phone_normalized TEXT,                       -- 标准化号码（去+86/空格/-）
    relationship     TEXT,                       -- 关系：家人/同事/朋友/快递/客服
    importance       INTEGER DEFAULT 0,          -- 0=普通 1=重要 2=紧急联系人
    is_blacklist     INTEGER DEFAULT 0,          -- 黑名单
    is_whitelist     INTEGER DEFAULT 0,          -- 白名单（跳过振铃直接接听）
    last_call_at     TIMESTAMP,                  -- 最后通话时间
    call_count       INTEGER DEFAULT 0,          -- 累计通话次数
    notes            TEXT,                       -- 备注
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_contacts_phone ON contacts(phone_normalized);
CREATE INDEX idx_contacts_blacklist ON contacts(is_blacklist);
CREATE INDEX idx_contacts_whitelist ON contacts(is_whitelist);
```

### 3.2 calls 表

```sql
CREATE TABLE IF NOT EXISTS calls (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id     INTEGER,                      -- NULL = 未知号码
    phone          TEXT,                         -- 号码（兜底）
    direction      TEXT,                         -- inbound / outbound
    status         TEXT,                         -- answered / missed / rejected / voicemail
    duration       INTEGER,                      -- 通话秒数
    recording_path TEXT,                         -- 录音文件路径
    transcript     TEXT,                         -- ASR 转写文本
    summary        TEXT,                         -- LLM 摘要
    tags           TEXT,                         -- JSON 数组标签
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

CREATE INDEX idx_calls_contact ON calls(contact_id);
CREATE INDEX idx_calls_created ON calls(created_at);
```

### 3.3 unknown_callers 表（自动学习）

```sql
CREATE TABLE IF NOT EXISTS unknown_callers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT UNIQUE NOT NULL,
    first_seen   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen    TIMESTAMP,
    call_count   INTEGER DEFAULT 1,
    labeled      INTEGER DEFAULT 0              -- 是否已被用户标注
);
```

### 3.4 号码标准化规则

| 输入 | 输出 | 规则 |
|------|------|------|
| +8613980819087 | 13980819087 | 去 +86 |
| 139-8081-9087 | 13980819087 | 去分隔符 |
| 02112345678 | 2112345678 | 去长途前缀 0 |
| 13980819087 | 13980819087 | 已是标准格式 |
| 匹配策略 | 后 7 位模糊匹配 | 防止区号差异导致匹配失败 |

---

## 四、通讯录功能价值矩阵

| 功能场景 | 无通讯录 | 有通讯录 | 依赖字段 |
|---------|---------|---------|---------|
| 来电推送 | "139xxxx 打来" | "老妈打来电话" | name |
| 接听策略 | 一律接听 | 黑名单拒接 / VIP 秒接 | is_blacklist / is_whitelist |
| 提示音 | 通用提示音 | "您好，灵须子的助理玄枢" | relationship |
| 转写摘要 | "某人说..." | "老妈说周末回家吃饭" | name |
| 主动外呼 | 只能拨号码 | "给老妈打电话"→自动查号 | name + phone |
| 未接回拨 | 无意义数字 | "3个未接：老妈/张三/快递" | name |
| 通话统计 | 无法聚合 | "本月与老妈通话 5 次，共 23 分钟" | contact_id + call_count |
| 未知号码 | 完全丢失 | 自动记录 + 3次提醒加入 | unknown_callers |

---

## 五、系统架构

### 5.1 推荐架构：监听-处理解耦

```
┌─────────────────────────────────────────────────────────────┐
│  进程1：4g-listener（AT 监听器）                               │
│  - pyserial 读取 URC 事件（RING / +CLIP / NO CARRIER / +CMT） │
│  - 控制 ATA / ATD / AT+CHUP                                 │
│  - 管理 arecord 录音生命周期                                   │
│  - 通讯录匹配（仅读，轻量查询）                                 │
│  - 通话结束后 → 写入事件文件 → 立即返回监听                     │
│  ⏱️ 毫秒级响应，不阻塞                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │ 文件系统事件队列
                       │ /tmp/voice-events/*.json
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  进程2：call-processor（后处理器）                              │
│  - 监控事件目录（inotify）                                      │
│  - FunASR / Whisper 转写（可阻塞，不影响监听）                   │
│  - LLM 摘要生成                                               │
│  - 更新 SQLite 数据库                                          │
│  - 微信推送                                                   │
│  - 更新联系人 last_call_at + call_count                       │
│  ⏱️ 异步处理，无实时性要求                                       │
└─────────────────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  SQLite          │  │  Edge-TTS        │  │  contacts.py     │
│  calls.db        │  │  (CLI)           │  │  (CLI 管理)      │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

### 5.2 现有能力映射到架构

| 现有能力 | 归属进程 | 改动 |
|---------|---------|------|
| AT 指令拨号/接听/挂断 | 进程1（监听器） | 加入通讯录匹配 |
| 来电监听 + 自动接听 | 进程1（监听器） | 白名单跳过振铃 |
| 短信接收 + PDU 解码 | 进程1（监听器） | 号码匹配通讯录 |
| by-id 端口发现 | 进程1（监听器） | 不变 |
| 硬件环回录音 | 进程1（监听器） | 增加增益控制 |
| 提示音异步播放 | 进程1（监听器） | 不变 |
| 启动残留检查 | 进程1（监听器） | 不变 |
| FunASR 转写 | 进程2（后处理器） | 从监听器移入 |
| Whisper 兜底 | 进程2（后处理器） | 从监听器移入 |
| LLM 摘要 | 进程2（后处理器） | 统一代码（合并3份冗余） |
| 微信推送 | 进程2（后处理器） | 增加联系人姓名显示 |
| 数据库操作 | 进程2（后处理器） | JSONL → SQLite |

### 5.3 事件文件格式

```json
{
    "event": "call_ended",
    "phone": "18180805797",
    "contact_name": "姚旭（测试号）",
    "direction": "inbound",
    "status": "answered",
    "duration": 45,
    "recording_path": "/home/ai/.openclaw/workspace/voice-system/recordings/inbound/20260414_043000_18180805797.wav",
    "timestamp": "2026-04-14T04:30:00+08:00"
}
```

---

## 六、风险点及根本解决方案

### R1：来电只显示号码（🔴 已验证发生）

| 维度 | 内容 |
|------|------|
| **现象** | 23条通话记录，5个号码，全部以裸号码显示 |
| **影响** | 推送信息价值为零，无法做差异化处理 |
| **根因** | 无通讯录数据 |
| **根本解决** | Phase 1 创建 SQLite contacts 表 → 来电查表 → 推送显示姓名 |
| **工作量** | 1-2 天 |

### R2：录音质量不可控（🔴 已验证发生）

| 维度 | 内容 |
|------|------|
| **现象** | 4月13日实测：12% clipping + 电流声 |
| **影响** | 转写准确率下降，所有 AI 功能数据基础受损 |
| **根因** | ① arecord 默认增益过高 ② 地环路噪声 ③ PH2.0 模拟信号质量不稳定 |
| **根本解决（三层）** | |
| 层1（立即） | arecord 加 `-v 0.3` 降低增益 + 录音后 sox norm -3dB 后处理 |
| 层2（硬件） | 音频隔离器到货后安装，物理切断地环路 |
| 层3（监控） | 每次录音结束自动分析 dBFS 峰值，> -1dB 标记"可能失真" |
| **工作量** | 1-2 天 |

### R3：ASR 同步阻塞来电监听（🔴 架构风险）

| 维度 | 内容 |
|------|------|
| **现象** | 4g-combined-listener.py 通话结束后同步执行 transcribe()，FunASR 耗时 20-60 秒 |
| **影响** | 阻塞期间串口缓冲区持续增长（>2000字节截断），可能漏接来电 |
| **根因** | 监听和处理在同一进程同一线程同步执行 |
| **根本解决** | 解耦为两个进程：监听器写事件文件 → 立即返回；后处理器异步消费 |
| **工作量** | 2-3 天 |

### R4：只能录到对方声音（🔴 物理限制）

| 维度 | 内容 |
|------|------|
| **现象** | 硬件环回只录到 A7670G Audio OUT（对方声音） |
| **影响** | 转写不完整；Voice Call AI 需要双向音频 |
| **根因** | 模块音频不经过 Linux ALSA |
| **根本解决（三层）** | |
| 方案A（推荐） | `pactl load-module module-loopback` 创建系统音频回环，合并双声道（左=对方，右=自己） |
| 方案B（备用） | arecord 双路录制：Line-In 录对方 + pulse 录自己，后期 sox -m 合并 |
| 方案C（妥协） | 只录对方，摘要标注"对方说..."（不适用于 Voice Call AI） |
| **工作量** | 2-3 天 |

### R5：TTS 外呼音频无法送入模块（🔴 硬件限制）

| 维度 | 内容 |
|------|------|
| **现象** | AT+CCMXPLAY 需要文件在模块内部，上传不可用 |
| **影响** | 外呼后无法播放 TTS 语音给对方 |
| **根因** | A7670G 音频通道独立，不走 SIP |
| **根本解决** | 反向硬件环回：主机 TTS → aplay 播放 → 3.5mm 音频线 → 模块 MIC 输入 |
| **成本** | ¥5（一根 3.5mm 公对公音频线） |
| **工作量** | 3-4 天 |

### R6：串口断开后无法自动恢复（🔴 Opus 独有发现）

| 维度 | 内容 |
|------|------|
| **现象** | USB 串口可能断开重连（USB 总线复位/模块重启），pyserial 抛 SerialException |
| **影响** | 重连间隙可能漏掉来电 |
| **根因** | 重连后缓冲区状态丢失 |
| **根本解决** | ① systemd 替代 PM2（Restart=always + RestartSec=3）② 重连后立即 AT+CLCC 检查 ③ udevadm 监控端口断开主动 kill 进程 |
| **工作量** | 1 天 |

### R7：FunASR 外部依赖（🟡）

| 维度 | 内容 |
|------|------|
| **现象** | FunASR 需上传音频到第三方（catbox.moe） |
| **影响** | 断网时无法转写 |
| **根本解决** | 已有 Whisper 本地回退；长期考虑本地部署 Faster-Whisper large-v3（GPU 已有） |
| **工作量** | 已有，持续维护 |

### R8：SQLite 并发写入（🟡）

| 维度 | 内容 |
|------|------|
| **现象** | PM2 守护进程持续运行，可能并发写入 |
| **影响** | 数据库锁 |
| **根本解决** | `PRAGMA journal_mode=WAL;` 允许读写并发 |
| **工作量** | 30min |

### R9：号码格式不统一（🟡）

| 维度 | 内容 |
|------|------|
| **现象** | CLIP 返回格式多样（+86/无前缀/区号） |
| **影响** | 通讯录匹配失败 |
| **根本解决** | normalize_phone() 函数 + phone_normalized 字段 + 后7位模糊匹配 |
| **工作量** | 1h |

### R10：API Key 硬编码（🟡 Opus 独有发现）

| 维度 | 内容 |
|------|------|
| **现象** | 多个脚本各自硬编码 DashScope/DeepSeek Key |
| **影响** | 维护困难，安全风险 |
| **根本解决** | 统一配置到 voice-system/config/settings.yaml（不纳入 git） |
| **工作量** | 1h |

### R11：录音文件无限增长（🟢）

| 维度 | 内容 |
|------|------|
| **现象** | recordings/inbound/ 已有 23 个文件，长期增长 |
| **影响** | 占满存储 |
| **根本解决** | cron 每周清理，保留最近 30 天，更久的只保留转写+摘要 |
| **工作量** | 30min |

---

## 七、分阶段实施计划

### Phase 1：通讯录基础（1-2天）⭐ 最先做

| # | 任务 | 工时 | 依赖 | 交付物 |
|---|------|------|------|--------|
| 1.1 | 创建 SQLite calls.db（contacts + calls + unknown_callers 表） | 30min | 无 | 数据库文件 |
| 1.2 | 编写 contacts.py CLI（add/search/list/blacklist/import） | 2h | 1.1 | 管理脚本 |
| 1.3 | JSONL → SQLite 迁移（23条已有数据） | 30min | 1.1 | 数据迁移 |
| 1.4 | 提取现有号码列表，提示用户确认 | 30min | 1.3 | 候选联系人清单 |
| 1.5 | listener.py 集成号码→姓名查询 | 1h | 1.1 | 来电显示姓名 |
| 1.6 | 微信推送文案改造 | 30min | 1.5 | "老妈打来"而非"139xxxx" |

**里程碑**：来电微信推送显示联系人姓名

### Phase 2：录音质量修复（1-2天）

| # | 任务 | 工时 | 依赖 | 交付物 |
|---|------|------|------|--------|
| 2.1 | arecord 增益调整（-v 0.3） | 1h | 无 | 不 clipping 的录音 |
| 2.2 | 录音后自动 dBFS 峰值检测 | 1h | 无 | 质量监控 |
| 2.3 | 音频隔离器到货安装 + 测试底噪 | 0.5h | 硬件到货 | 无电流声录音 |
| 2.4 | 双向录音验证（pactl module-loopback） | 2h | 无 | 双方声音都录到 |

**里程碑**：清晰的、不 clipping 的、包含双方声音的录音

### Phase 3：监听-处理解耦（2-3天）

| # | 任务 | 工时 | 依赖 | 交付物 |
|---|------|------|------|--------|
| 3.1 | 重构 listener.py：移除 ASR/LLM/推送，保留 AT 监听+录音+事件写入 | 3h | 无 | 精简监听器 |
| 3.2 | 新建 call-processor.py：消费事件，转写→摘要→推送→入库 | 3h | 无 | 独立后处理器 |
| 3.3 | 统一 LLM 摘要代码（合并3份冗余） | 1h | 3.2 | 单一代码源 |
| 3.4 | 事件文件队列（/tmp/voice-events/） | 1h | 3.1 | 解耦通道 |
| 3.5 | PM2 配置更新（两个独立进程） | 0.5h | 3.1+3.2 | 双进程守护 |
| 3.6 | 端到端测试：完整通话→录音→转写→摘要→推送 | 1h | 3.1-3.5 | 回归测试通过 |
| 3.7 | （可选）systemd 替代 PM2 | 1h | 3.5 | 更高可靠性 |

**里程碑**：解耦架构上线，后处理不再阻塞来电监听

### Phase 4：差异化策略（1天）

| # | 任务 | 工时 | 依赖 | 交付物 |
|---|------|------|------|--------|
| 4.1 | 白名单：跳过振铃，直接 ATA | 0.5h | Phase 1 | VIP 秒接 |
| 4.2 | 黑名单：自动 AT+CHUP 挂断 | 0.5h | Phase 1 | 骚扰拦截 |
| 4.3 | 未知号码：保持现有逻辑（2次振铃后接听） | 0.5h | 无 | 兜底策略 |
| 4.4 | 重要联系人推送加急 | 0.5h | Phase 1 | 分级通知 |
| 4.5 | 按关系播放不同提示音 | 1h | Phase 1 | 个性化提示 |
| 4.6 | 短信号码匹配通讯录 | 0.5h | Phase 1 | 短信显示姓名 |

**里程碑**：来电根据通讯录身份自动采取不同策略

### Phase 5：TTS 外呼（3-4天）

| # | 任务 | 工时 | 依赖 | 交付物 |
|---|------|------|------|--------|
| 5.1 | Edge-TTS Python 封装（CLI → 模块调用） | 2h | 无 | TTS 集成 |
| 5.2 | 音频线反向环回验证（主机输出 → 模块 MIC） | 2h | Phase 2 | 外呼播放可行 |
| 5.3 | 外呼流程改造：ATD → 检测通话 → 播放 TTS → 录音 → 挂断 | 3h | 5.1+5.2 | 完整外呼 |
| 5.4 | "给XX打电话"自然语言 | 2h | Phase 1 | 通讯录查号 → 自动拨打 |
| 5.5 | 未接来电回拨提醒（cron） | 1h | Phase 1 | 定时检查 |
| 5.6 | 外呼记录入 SQLite | 0.5h | Phase 3 | 数据完整 |

**里程碑**：自然语言拨号 + TTS 语音播报

### Phase 6：Voice Call AI（3-5天，待定）

| # | 任务 | 工时 | 依赖 | 交付物 |
|---|------|------|------|--------|
| 6.1 | Silero VAD 安装集成 | 2h | 无 | 语音活动检测 |
| 6.2 | 实时转写管线（VAD → Whisper → LLM） | 3h | 6.1 | 流式转写 |
| 6.3 | 流式 TTS 播放（Edge-TTS 流式输出） | 2h | 无 | 低延迟播放 |
| 6.4 | 打断机制（"停"关键字检测） | 2h | 6.2+6.3 | 用户可打断 |
| 6.5 | PM2 守护整合（voice_call_manager） | 1h | 6.1-6.4 | 稳定运行 |

**里程碑**：来电后与 AI 实时语音对话

---

## 八、推荐执行顺序（时间线）

```
Day 1（今天）
  ✅ 1.1 创建 SQLite 数据库
  ✅ 1.2 编写 contacts.py CLI
  ✅ 1.3 JSONL → SQLite 迁移
  ✅ 1.4 提取号码清单
  ✅ 1.5 listener.py 集成姓名查询
  ✅ 1.6 推送文案改造

Day 2（明天）
  ⬜ 2.1 arecord 增益调整
  ⬜ 2.2 录音后 dBFS 检测
  ⬜ 2.3 音频隔离器安装（到货后）
  ⬜ 2.4 双向录音验证

Day 3（后天）
  ⬜ 3.1 重构 listener.py
  ⬜ 3.2 新建 call-processor.py
  ⬜ 3.3 统一摘要代码
  ⬜ 3.4 事件文件队列
  ⬜ 3.5 PM2 双进程配置
  ⬜ 3.6 端到端测试

Day 4-5
  ⬜ 4.1-4.6 差异化策略
  ⬜ 5.1-5.3 TTS 外呼基础

Day 6-8
  ⬜ 5.4-5.6 TTS 外呼完善

Day 9+
  ⬜ 6.1-6.5 Voice Call AI（待定）
```

---

## 九、关键决策点

| # | 决策 | 选项 | 推荐 | 理由 |
|---|------|------|------|------|
| D1 | 进程管理器 | PM2 vs systemd | 先用 PM2，Phase 3 后评估 systemd | 现有 PM2 在运行，改动最小 |
| D2 | 双向录音 | pactl loopback vs 双路录制 | pactl loopback | 成本0元，纯软件 |
| D3 | TTS 外呼 | 反向环回 vs 模块上传 | 反向环回 | 上传不可用，硬件方案唯一可行 |
| D4 | ASR 引擎 | FunASR 优先 vs Whisper 优先 | FunASR 优先，Whisper 回退 | FunASR 中文质量更好 |
| D5 | 解耦时机 | 立即解耦 vs 渐进增强 | Phase 3 解耦 | 先做通讯录和录音修复，收益更大 |

---

## 十、CLI 管理接口设计

### contacts.py

```bash
# 添加联系人
python3 contacts.py add --name "老妈" --phone "13980819087" --relationship "家人" --importance 2

# 搜索
python3 contacts.py search "老妈"
python3 contacts.py search "139"

# 列出全部
python3 contacts.py list
python3 contacts.py list --relationship "家人"

# 标记黑名单
python3 contacts.py blacklist "13700000000"

# 标记白名单
python3 contacts.py whitelist "13980819087"

# 批量导入 CSV
python3 contacts.py import contacts.csv

# 导出
python3 contacts.py export contacts.json
```

### 4G 系统管理

```bash
# 查看服务状态
4g-system status

# 重启监听
4g-system restart listener
4g-system restart processor

# 查看日志
4g-system logs listener --lines 50
4g-system logs processor --lines 50

# 查看今日通话
4g-system calls --today

# 查看某联系人通话
4g-system calls --contact "老妈"
```

---

## 十一、目录结构（最终目标）

```
/home/ai/.openclaw/workspace/voice-system/
├── data/
│   ├── calls.db                    # SQLite 数据库
│   └── contacts.csv                # 可导入的 CSV 模板
├── recordings/
│   ├── inbound/                    # 来电录音
│   └── outbound/                   # 外呼录音
├── config/
│   └── settings.yaml               # 统一配置（API Key 等）
├── src/
│   ├── 4g-listener.py              # 进程1：AT 监听器（重构后）
│   ├── call-processor.py           # 进程2：后处理器
│   ├── contacts.py                 # 通讯录 CLI
│   ├── transcribe.py               # ASR 转写（FunASR + Whisper）
│   ├── summarizer.py               # LLM 摘要（统一代码）
│   ├── notifier.py                 # 微信推送
│   ├── tts.py                      # Edge-TTS 封装
│   ├── audio_device.py             # 音频设备管理
│   └── phone_utils.py              # 号码标准化 + 匹配
├── scripts/                        # 保留现有脚本（兼容）
│   ├── 4g-call
│   ├── 4g-sms
│   ├── 4g-answer
│   └── 4g-combined-listener.py     # 旧版（保留备份）
├── ecosystem.4g.yaml               # PM2 配置
├── start-4g.sh                     # 启动脚本
└── PLAN-FINAL-v3.md                # 本方案文档
```

---

_方案结束。等待审批后按 Phase 1 开始执行。_
