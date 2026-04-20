# 4G语音通讯系统 — 三方综合对比报告

> 玄枢综合 Claude Opus + Qwen Max 双方案精华
> 日期：2026-04-14
> 原始报告：
> - REPORT-CLAUDE-OPUS-4G-VOICE.md（Claude Opus，71KB）
> - REPORT-QWEN-PLUS-4G-VOICE.md（Qwen Max，34KB）

---

## 一、两方案共识：通讯录是基石

**两模型100%一致同意的第一优先级：通讯录。**

```
没有通讯录 → 来电只显示号码 → 无法差异化处理 → 功能天花板
有了通讯录 → 来电匹配身份 → 策略分流 → AI能力全面释放
```

两方案都指出：现有系统最大问题是"来电裸号码推送"，毫无意义。

---

## 二、架构设计对比

### 2.1 进程模型

| 维度 | Claude Opus 方案 | Qwen Max 方案 |
|------|----------------|---------------|
| 进程数 | **双进程**：listener（毫秒响应）+ processor（异步后处理）| **单进程保留 + 解耦**：listener简化，processor独立 |
| 事件传递 | 文件系统事件队列（`/tmp/voice-events/*.json`）| **Redis Stream**（原生事件总线）|
| 优势 | 简单，调试直观 | 可扩展，支持多worker并行消费 |
| 风险 | 文件系统事件不如Redis可靠 | Redis依赖，但本机已运行Redis |

### 2.2 裁决

**Qwen Max 的 Redis Stream 方案更优**，理由：
- 已运行 Redis，无需新增依赖
- 支持多 processor 并行，ASR转写不排队
- 已有 graph-linker 消耗 Redis Stream，可直接复用模式

### 2.3 数据库选择

| 维度 | Claude Opus | Qwen Max |
|------|------------|---------|
| 选择 | PostgreSQL（openclaw_memory）| PostgreSQL（openclaw_memory）| ✅ 一致 |
| 表设计 | 5张表（contacts/calls/sms/unknown_numbers/call_tasks）| 4张表（contacts/calls/sms/tasks）| 略有差异 |

**裁决**：采用 Claude Opus 的 5表设计（更完整，含 unknown_numbers 学习表和 call_tasks 队列）

---

## 三、通讯录设计对比

### 3.1 Schema 差异

| 字段 | Claude Opus | Qwen Max | 推荐 |
|------|-----------|---------|------|
| importance 字段 | 3级（0普通/1重要/2紧急）| 2级（is_blacklist/is_whitelist）| **合并**：同时保留黑白名单 AND importance 等级 |
| 号码标准化 | phone_normalized 索引列 | normalize_phone() 函数 | **合并**：同时建函数+索引列 |
| unknown_numbers 表 | 独立表，含AI建议名称 | 无独立表，直接建联系人 | **采用 Claude Opus**：独立表更利于学习积累 |
| 来电学习机制 | 同号码3次触发通知 | 无明确机制 | **采用 Opus**：自动学习机制更完整 |

---

## 四、AI语音管线对比

### 4.1 ASR策略

| 维度 | Claude Opus | Qwen Max |
|------|------------|---------|
| 主力 | FunASR（dashscope API）| FunASR |
| 兜底 | Whisper large-v3-turbo | Whisper（未明确版本）|
| 降级策略 | 明确（FunASR失败→Whisper）| 未明确 | **采用 Opus** |

### 4.2 TTS外呼（最大难题）

两方案都承认核心障碍：**TTS音频无法直接送入4G模块**。

| 方案 | Claude Opus | Qwen Max |
|------|------------|---------|
| 方案A | 主机TTS → 3.5mm音频线 → 模块麦克风输入 | 主机播放 → 音频线 → 模块 |
| 方案B | pactl 音频回环（双向录制）| pactl 音频回环 |
| 共识 | ✅ 音频线方案可行（成本¥5）| ✅ |

**裁决**：采用统一方案——**主机TTS播放 + 3.5mm音频线环回 + 模块麦克风输入**。同一根线同时解决录音（对方声音）和TTS播放（对方听到）。

### 4.3 Voice Call AI（实时对话）

| 维度 | Claude Opus | Qwen Max |
|------|------------|---------|
| 架构 | VAD → Whisper增量 → LLM → Edge-TTS流式 | 简化版（一问一答）|
| VAD | Silero VAD | 未明确 |
| 打断机制 | 用户说"停"检测 | 未明确 |
| 共识 | ✅ 长期目标，但依赖音频流捕获 | ✅ |

**裁决**：短期先实现 Phase 1-3（通讯录+录音+推送），Voice Call AI 作为 Phase 4 独立推进。

---

## 五、风险评估综合

### 5.1 核心风险对比

| 风险 | Claude Opus 评估 | Qwen Max 评估 | 综合裁决 |
|------|-----------------|--------------|---------|
| 只能录到对方 | 🔴 高概率/高影响 | 🔴 高影响 | **根本解决**：pactl loopback 双向录制 |
| TTS无法送给对方 | 🔴 高概率/高影响 | 🔴 高影响 | **根本解决**：音频线反向环回 |
| 中文短信发送 | 🟡 中概率/中影响 | 🟡 中影响 | **接受局限**：换用TTS外呼替代 |
| ASR同步阻塞 | 🔴 高概率/高影响 | 🔴 高影响 | **根本解决**：双进程解耦（processor异步）|
| 录音质量（clipping）| 🔴 高影响 | 🟡 中影响 | **根本解决**：音频隔离器 + arecord 参数调优 |
| SQLite并发 | 🟡 中概率/低影响 | — | **不采用SQLite**：用PostgreSQL WAL模式 |

---

## 六、实施计划综合（最优路径）

### Phase 0：诊断与准备（1天）
- [ ] 测试 Redis Stream 连通性
- [ ] 验证 arecord 设备路径稳定性（by-id）
- [ ] 确认模块 AT 端口路径（udev 固定）

### Phase 1：通讯录核心（2天）⭐ 最优先
- [ ] PostgreSQL 表创建（contacts/calls/sms/unknown_numbers/call_tasks）
- [ ] JSONL → PostgreSQL 数据迁移（现有23条通话记录）
- [ ] 通讯录 CRUD CLI 工具
- [ ] 来电号码→姓名匹配逻辑集成到 listener
- [ ] 微信推送从号码改为姓名

### Phase 2：录音与后处理（2天）
- [ ] 双进程架构：listener（事件）+ processor（消费）
- [ ] Redis Stream 事件传递
- [ ] 硬件环回录制稳定化（arecord 参数调优）
- [ ] FunASR → Whisper 降级策略
- [ ] LLM 摘要 → DB写入 → 微信推送

### Phase 3：策略与外呼（2天）
- [ ] 黑白名单/VIP策略执行
- [ ] 未知号码自动学习（3次触发通知）
- [ ] Edge-TTS 集成（Python封装，非CLI）
- [ ] TTS外呼音频线方案验证
- [ ] "给XX打电话"自然语言指令

### Phase 4：Voice Call AI（3-5天，待定）
- [ ] Silero VAD 集成
- [ ] 实时流式 Whisper
- [ ] LLM 对话上下文管理
- [ ] Edge-TTS 流式合成
- [ ] 打断机制（"停"关键字）

---

## 七、技术选型最终决策

| 模块 | 决策 | 理由 |
|------|------|------|
| 数据库 | **PostgreSQL**（openclaw_memory）| 已有，零新增依赖 |
| 事件总线 | **Redis Stream** | 已有在运行服务 |
| ASR主力 | **FunASR**（dashscope）| 已有配置 |
| ASR兜底 | **Whisper large-v3-turbo** | 本地GPU推理 |
| TTS | **Edge-TTS**（Python封装）| 免费，中文质量好 |
| LLM摘要 | **Qwen-max** | 已有key |
| 进程管理 | **PM2** | 已有使用经验 |
| 推送 | **OpenClaw微信** | 已有通道 |
| 音频录制 | **arecord + pactl loopback** | 软件方案，零成本 |

---

## 八、目录结构最终方案

```
/home/ai/.openclaw/workspace/voice-system/
├── data/
│   ├── contacts.db           # PostgreSQL 连接配置（.env）
│   └── migrations/          # SQL 迁移脚本
├── src/
│   ├── listener.py           # 进程1：AT串口监听（PM2: 4g-listener）
│   ├── processor.py          # 进程2：事件消费（PM2: 4g-processor）
│   ├── contacts.py           # 通讯录库（CRUD + 匹配 + 策略）
│   ├── recorder.py           # arecord 封装
│   ├── transcriber.py        # FunASR + Whisper 降级
│   ├── summarizer.py        # LLM 摘要
│   ├── notifier.py          # OpenClaw 微信推送
│   ├── outbound.py           # 外呼管理
│   ├── sms.py               # 短信收发（PDU）
│   └── db.py                # PostgreSQL 连接池
├── scripts/
│   ├── 4g-call              # 拨号CLI（保留）
│   ├── 4g-sms               # 短信CLI（保留）
│   └── voice-cli            # 新增：通讯录管理CLI
├── tests/
│   └── test_integration.py  # 集成测试
├── requirements.txt
└── README.md
```

---

## 九、立即可执行的命令

### 创建数据库表
```sql
-- 在 PostgreSQL openclaw_memory 中执行
CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    phone_normalized VARCHAR(20) NOT NULL,
    relationship VARCHAR(20),
    importance SMALLINT DEFAULT 0,
    is_blacklist BOOLEAN DEFAULT FALSE,
    is_whitelist BOOLEAN DEFAULT FALSE,
    last_call_at TIMESTAMPTZ,
    call_count INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calls (
    id SERIAL PRIMARY KEY,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
    caller_phone VARCHAR(20) NOT NULL,
    contact_id INTEGER REFERENCES contacts(id),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration INTEGER,
    status VARCHAR(20) DEFAULT 'completed',
    wav_path TEXT,
    transcript TEXT,
    summary TEXT,
    raw_transcript JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms (
    id SERIAL PRIMARY KEY,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound','outbound')),
    sender_phone VARCHAR(20) NOT NULL,
    contact_id INTEGER REFERENCES contacts(id),
    content TEXT,
    pdu_raw TEXT,
    status VARCHAR(20) DEFAULT 'received',
    received_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS unknown_numbers (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    phone_normalized VARCHAR(20) NOT NULL,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    call_count INTEGER DEFAULT 1,
    total_duration INTEGER DEFAULT 0,
    has_been_notified BOOLEAN DEFAULT FALSE,
    suggested_name VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_contacts_phone_norm ON contacts(phone_normalized);
CREATE INDEX idx_contacts_blacklist ON contacts(is_blacklist) WHERE is_blacklist = TRUE;
CREATE INDEX idx_calls_contact ON calls(contact_id);
CREATE INDEX idx_calls_start_time ON calls(start_time DESC);
CREATE INDEX idx_unknown_phone ON unknown_numbers(phone_normalized);
```

### PM2 ecosystem 配置
```yaml
apps:
  - name: 4g-listener
    script: src/listener.py
    interpreter: python3
    watch: src/
    max_memory_restart: 200M
    
  - name: 4g-processor
    script: src/processor.py
    interpreter: python3
    watch: src/
    max_memory_restart: 500M
```

---

## 十、两方案精华总结

### Claude Opus 方案优势
1. **更详细的录音质量分析**（量化了 clipping 问题）
2. **完整的 unknown_numbers 自动学习机制**
3. **call_tasks 独立任务队列表**（支持重试）
4. **Redis Stream 事件传递设计更完整**
5. **详细的技术选型对比表**

### Qwen Max 方案优势
1. **架构图更清晰**（分层明确）
2. **号码标准化函数设计**更健壮（含国际长途前缀处理）
3. **通信层时序图**更详细
4. **风险评估覆盖更全面**（含SQLite并发问题）
5. **CLI 设计更完善**（voice-cli 统一管理）

---

_综合报告生成时间：2026-04-14_
_玄枢·太虚智网灵枢_
