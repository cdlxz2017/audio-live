# 4G语音通讯系统 v2 - 深度分析与完整实现任务

## 背景

当前4G语音系统已具备基础能力（A7670G模块 + AT命令 + 来电监听 + 录音 + Whisper转写 + 微信推送）。
现在需要基于现有能力，构建4个功能模块，形成完整的语音通讯系统。

**硬件环境（已确认）：**
- AT命令口：`/dev/ttyUSB1` (115200)
- 短信口：`/dev/ttyUSB2` (115200)
- 音频录制：`card 1: ALC245 Analog, device 0` → `plughw:1,0`
- 音频输出：`card 0: HDMI (ROG PG248Q)` → `plughw:0,3`
- PostgreSQL：host=localhost, port=5432, db=openclaw_memory, user=openclaw_ai, password=zyxrcy910128
- Edge-TTS：已安装 v7.2.8
- Whisper：可用（large-v3-turbo，本地GPU）
- openclaw message：微信推送 via openclaw-weixin channel

## 现有代码参考

```bash
# 关键文件
/home/ai/.openclaw/workspace/scripts/4g-combined-listener.py  # 主监听器（497行）
/home/ai/.openclaw/workspace/scripts/4g-sms-listener.py         # 短信监听
/home/ai/.openclaw/workspace/scripts/4g-sms-decode.py           # PDU解码
/home/ai/.openclaw/workspace/voice-system/src/voice_call_handler.py  # 通话后处理
/home/ai/.openclaw/workspace/voice-system/src/push_call_summary.py   # 推送脚本
/home/ai/.openclaw/workspace/scripts/4g-call                     # 拨号CLI脚本
/home/ai/.openclaw/workspace/scripts/4g-answer                   # 接听CLI脚本
```

## 要实现的4个模块

### 模块1：通讯录（contacts）

**功能：**
- 通讯录CRUD（增删改查）
- 来电号码自动识别（匹配姓名）
- 联系人分类（家人/同事/朋友/快递/客服/其他）
- 重要程度标记（普通/重要/紧急）
- 黑名单（自动挂断）
- 白名单（跳过振铃直接接听）
- 未知号码记录 + 建议添加

**实现要点：**
- 使用PostgreSQL `openclaw_memory`数据库（已有连接）
- 表名：`voice_contacts`
- 号码标准化函数（去+86/空格/横线/括号）
- 后7位模糊匹配作为兜底
- `voice-cli.py contact add/search/list/blacklist/whitelist` CLI

**数据库Schema：**
```sql
CREATE TABLE voice_contacts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    phone_normalized VARCHAR(20) NOT NULL,
    relationship VARCHAR(20) DEFAULT '其他',
    importance SMALLINT DEFAULT 0,  -- 0=普通 1=重要 2=紧急
    is_blacklist BOOLEAN DEFAULT FALSE,
    is_whitelist BOOLEAN DEFAULT FALSE,
    notes TEXT,
    call_count INTEGER DEFAULT 0,
    last_call_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_vc_phone_norm ON voice_contacts(phone_normalized);
CREATE INDEX idx_vc_blacklist ON voice_contacts(is_blacklist) WHERE is_blacklist = TRUE;
CREATE INDEX idx_vc_name_trgm ON voice_contacts USING gin(name gin_trgm_ops);
```

**CLI命令设计：**
```bash
voice-cli contact add --name "老妈" --phone "13980819087" --relationship "家人" --importance 2
voice-cli contact add --phone "13800000000" --name "快递" --is-whitelist
voice-cli contact list
voice-cli contact search "老妈"
voice-cli contact blacklist <phone>
voice-cli contact whitelist <phone>
voice-cli contact delete <phone>
```

---

### 模块2：录音 + 保存 + 转写 + 微信推送（Enhanced Pipeline）

**功能：**
- 来电自动录音（增益控制，修复clipping问题）
- 录音保存到 `voice-system/recordings/inbound/`
- Whisper本地转写（GPU加速）
- LLM摘要（MiniMax API）
- 微信推送（联系人姓名 + 摘要 + 时长 + 转写）
- 录音质量自动检测（标记失真）

**实现要点：**
- 录音参数修复：`arecord -D plughw:1,0 -f S16_LE -r 16000 -c 1 -v 0.3`（增益30%，防clipping）
- 录音结束后ffmpeg loudnorm标准化到-3dB峰值
- 质量检测：ffmpeg volumedetect，标记 max_volume > -1dB
- Whisper: `whisper.load_model('large-v3-turbo')` 本地GPU
- LLM: MiniMax API（base_url + api_key配置化）
- 推送：调用openclaw message工具

**关键修复（区别于现有系统）：**
1. 录音增益控制：`-v 0.3` 替代默认增益（现有系统会clipping）
2. 采样率：16000（与Whisper要求一致，避免二次转码）
3. 录音格式：16kHz S16_LE（替代原来的8kHz）
4. 录音质量报告：每次录音后自动检测并写入DB

---

### 模块3：拨打电话 + 播放录音（TTS + Outbound）

**功能：**
- 根据通讯录姓名拨号（模糊匹配）
- 拨号前播放TTS语音（对方能听到）
- 播放录音文件给对方
- 支持手动指定号码拨号
- 通话时长记录

**实现要点：**
- ATD拨号命令（走/dev/ttyUSB1）
- Edge-TTS生成WAV文件（zh-CN-YunxiNeural男声）
- 用aplay通过HDMI输出 → 模块Audio IN物理环回给对方
- 录音保存到 `voice-system/recordings/outbound/`
- 流程：拨号 → 接通 → 播放TTS/录音 → 通话 → 挂断 → 保存记录

**注意：** 由于A7670G VoLTE音频走模块内部，不经过Linux ALSA，**自己说话对方听不到**。TTS语音播放给对方的方案：
```bash
# TTS → WAV → aplay通过HDMI → 3.5mm公对公 → 模块MIC输入 → 对方听到
aplay -D plughw:0,3 /tmp/tts.wav   # card 0 device 3 = HDMI输出
```
如果硬件未连接，播放给对方的TTS会失败但不影响录音（能录到对方声音）。

**CLI命令设计：**
```bash
voice-cli call dial --name "老妈"        # 通讯录匹配拨号
voice-cli call dial --phone 13980819087   # 直接拨号
voice-cli call play <录音文件.wav>        # 播放录音给当前通话
voice-cli call tts "你好，这是一条测试消息"  # TTS播放给通话对方
```

---

### 模块4：短信接收 + 发送 + 群发

**功能：**
- 接收短信 → PDU解码 → 写入DB → 微信推送
- 发送短信（Text模式，UCS2编码）
- 短信群发（支持多号码）
- 短信历史记录查询
- 发件人自动匹配通讯录

**实现要点：**
- 监听/dev/ttyUSB2的+CMT URC事件
- PDU解码（复用现有4g-sms-decode.py的decode函数）
- 发送：AT+CMGF=1 (Text模式) + AT+CSCS="UCS2"（支持中文）
- 群发：遍历号码列表，逐一发送
- 写DB：voice_sms表

**数据库Schema：**
```sql
CREATE TABLE voice_sms (
    id BIGSERIAL PRIMARY KEY,
    contact_id INTEGER REFERENCES voice_contacts(id) ON DELETE SET NULL,
    phone VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,  -- inbound / outbound
    content TEXT,
    encoding VARCHAR(20),            -- UCS-2 / 7-bit
    status VARCHAR(20) DEFAULT 'received',  -- received / sent / failed
    sms_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_vsms_contact ON voice_sms(contact_id);
CREATE INDEX idx_vsms_created ON voice_sms(created_at DESC);
CREATE INDEX idx_vsms_phone ON voice_sms(phone);
```

**CLI命令设计：**
```bash
voice-cli sms send --phone 13980819087 --content "你好"
voice-cli sms send --name "老妈" --content "今晚回来吃饭"
voice-cli sms group --phones "13900000001,13900000002" --content "通知：明天开会"
voice-cli sms list                    # 最近短信
voice-cli sms list --contact "老妈"  # 与某人的短信
```

---

## 系统架构

```
voice-system/v2/
├── src/
│   ├── __init__.py
│   ├── config.py              # 配置管理（DB/微信/模型配置）
│   ├── db.py                  # PostgreSQL连接池
│   ├── contacts_db.py         # 通讯录CRUD
│   ├── sms_db.py              # 短信存储
│   ├── calls_db.py            # 通话记录
│   ├── at_commands.py         # AT命令封装（拨号/接听/挂断/发短信）
│   ├── audio_recorder.py     # 录音（增益控制 + 质量检测）
│   ├── transcriber.py         # Whisper转写（GPU）
│   ├── summarizer.py          # LLM摘要（MiniMax）
│   ├── tts_client.py          # Edge-TTS封装
│   ├── notifier.py           # 微信推送
│   ├── voice_listener.py      # 主监听进程（来电 + 短信）
│   ├── outbound_handler.py    # 外呼处理（TTS播放 + 录音）
│   └── sms_handler.py         # 短信接收处理
├── sql/
│   └── init.sql               # 数据库初始化脚本
├── cli/
│   └── voice_cli.py          # 主CLI入口（voice-cli）
├── scripts/
│   ├── start-listener.sh     # 启动监听进程
│   └── start-outbound.sh     # 启动外呼服务
├── tests/
│   └── test_basic.py          # 基础测试
├── config.yaml                # 配置文件（不纳入git）
├── ecosystem.v2.yaml         # PM2配置
└── README.md
```

**事件驱动架构：**
- 监听进程（listener）：毫秒级响应，只做AT事件 + 录音 + 写事件文件
- 后处理（processor）：异步消费事件 → 转写 → 摘要 → DB → 推送
- 进程间通信：通过 `/tmp/voice-events/*.json` 文件

---

## 实施顺序

1. **数据库初始化**（sql/init.sql）
2. **config.py + db.py**（配置和连接）
3. **contacts_db.py**（通讯录CRUD）
4. **cli/voice_cli.py**（通讯录管理CLI，验证CRUD）
5. **at_commands.py**（AT命令封装）
6. **audio_recorder.py**（录音 + 质量检测）
7. **transcriber.py + summarizer.py + notifier.py**（转写+摘要+推送）
8. **voice_listener.py**（主监听进程，整合通讯录识别）
9. **sms_handler.py + sms_db.py**（短信接收 + 发送 + 群发）
10. **outbound_handler.py + tts_client.py**（外呼 + TTS播放）
11. **CLI完整命令**（整合所有模块）
12. **PM2配置 + 启动脚本**

---

## 注意事项

1. **API Key配置化**：所有API Key放到config.yaml，不硬编码
2. **异常处理**：每个模块要有try-except，不因单次失败崩溃
3. **日志记录**：所有操作记录到 `/home/ai/.openclaw/workspace/logs/voice-v2/`
4. **现有代码尊重**：复用 `4g-sms-decode.py` 的PDU解码逻辑
5. **PM2守护**：所有长期进程用PM2管理
6. **号码标准化**：去+86、去空格/横线/括号，存入phone_normalized字段
7. **录音防clipping**：arecord加`-v 0.3`增益控制
8. **硬件环回**：TTS播放给对方的方案需要3.5mm音频线物理连接，代码要能处理"未连接"的情况

---

## 完成后验收

1. `voice-cli contact add --name "测试" --phone "13800000000"` 成功添加
2. `voice-cli contact list` 显示通讯录
3. 来电时，监听进程能识别通讯录姓名
4. 录音文件生成在recordings/inbound/，无clipping
5. `voice-cli sms send --phone <号码> --content "测试"` 短信发送成功
6. `voice-cli call dial --phone <号码>` 能拨打电话
7. PM2进程正常运行：`pm2 list` 看到voice-listener
8. 所有日志写入 `/home/ai/.openclaw/workspace/logs/voice-v2/`

---

## 执行约束

- 工作目录：`/home/ai/.openclaw/workspace/voice-system`
- 新代码放到 `v2/` 子目录，不覆盖原有代码
- 完成后提交git：`cd /home/ai/.openclaw/workspace/voice-system && git add v2/ && git commit -m "feat: 4G语音通讯系统v2 - 完整实现4模块""`
- 每次实现一个模块后输出进度报告
- 遇到不确定的技术问题，先实现能实现的部分，标注待确认项
- 如果需要用户确认硬件或授权某项操作，明确告知
