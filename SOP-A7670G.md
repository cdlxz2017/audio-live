# A7670G 4G 模块使用手册

> 来源：DFRobot Wiki（TEL0163）
> 更新时间：2026-04-13
> 验证状态：✅ 已实测验证

---

## 一、产品规格

| 项目 | 参数 |
|------|------|
| 型号 | A7670G CAT1 4G 通信模块 |
| 上行/下行 | 5Mbps / 10Mbps |
| 网络制式 | LTE-FDD/LTE-TDD/WCDMA/GSM |
| 短信支持 | MT/MO/CB/TEXT/PDU |
| 串口波特率 | 115200（默认），9600~4Mbps 自动识别 |
| 供电电压 | 5V-12V（接线端子）或 5V（TYPE-C）|
| AT 端口 | `/dev/ttyUSB2`（主控通讯）|

---

## 二、基础 AT 指令

```bash
# 基本查询
AT              # 测试通信
AT+CGMM         # 查询模块型号 → A7670G-LLSE
AT+GSN          # 查询 IMEI
AT+CSQ          # 信号强度 → +CSQ: <rssi>,<ber>
AT+CPIN?        # SIM 卡状态 → +CPIN: READY
AT+COPS?        # 当前运营商 → +COPS: 0,2,"46011",7
AT+CREG?        # 语音注册状态 → +CREG: 0,0（未注册）/ 1,1（已注册）
AT+CEREG?       # EPS 数据注册 → +CEREG: 0,1
AT+CGDCONT?     # APN 配置
AT+CGACT?       # PDP 上下文状态
AT+CREG=0       # 关闭语音注册主动上报（发送 SMS 前推荐）
AT+CEREG=0      # 关闭 EPS 注册主动上报
AT+CNMI=0,0,0,0,0  # 关闭所有主动上报（防干扰）
```

---

## 三、打电话 ✅（已验证）

> 实测：CREG=0 状态下 VoLTE 电话依然可用

### 命令

| 命令 | 意义 |
|------|------|
| `ATD<号码>;` | 拨打语音电话（**末尾必须加分号**）|
| `AT+CHUP` | 挂断电话 |
| `ATA` | 接听来电 |
| `AT+CLIP=1` | 开启来电显示 |
| `AT+CNUM` | 查询本机号码 |

### 示例

```bash
# 拨打 10086
ATD10086;
# 响应: OK +CGEV: NW ACT 8,10
# 然后: VOICE CALL: BEGIN  ← 通话建立
# 通话结束: VOICE CALL: END / NO CARRIER

# 挂断
AT+CHUP

# 通话状态监控
AT+CLCC        # 查看当前通话列表
```

### 通话流程日志（实测）

```
ATD10086;
+MSTK: 11, "..."
+MSTK: 14
+CGEV: NW ACT 8,10      ← IMS 语音承载激活
+CLCC: 1,0,2,0,0,"10086",129,""   ← 正在拨号
+CLCC: 1,0,0,0,0,"10086",129,""   ← 通话中
+COLP: "10086",129       ← 对方号码确认
VOICE CALL: BEGIN        ← 通话开始
VOICE CALL: END: 000011  ← 通话时长 11 秒
NO CARRIER
```

### 快速拨号脚本

```bash
/home/ai/.openclaw/workspace/scripts/4g-call <号码> [auto|<秒数>]

# 示例
/home/ai/.openclaw/workspace/scripts/4g-call 10086         # 等待按 Enter 挂断
/home/ai/.openclaw/workspace/scripts/4g-call 10086 auto      # 20 秒后自动挂断
/home/ai/.openclaw/workspace/scripts/4g-call 18982054696 30 # 30 秒后自动挂断
```

---

## 四、发短信 ✅（英文）/ ⚠️（中文）

### 英文短信（已验证）

```bash
# 步骤 1: 设置文本模式
AT+CMGF=1

# 步骤 2: 发送号码（等收到 > 提示符）
AT+CMGS="18180805696"

# 步骤 3: 输入内容（不加回车），然后发送 Ctrl+Z (0x1A)
[输入内容后立即发送 0x1A]
# 成功响应: +CMGS: <index> OK
```

### 中文短信 ⚠️

**已知问题**：A7670G 固件文本模式不支持 UTF-8 中文，PDU 模式也存在固件限制。

**临时方案**：
1. 使用英文短信
2. 等待固件更新
3. 或换用 SIM7600 系列模块（中文 PDU 支持更好）

### 短信管理命令

| 命令 | 意义 |
|------|------|
| `AT+CPMS?` | 查看存储量和信息个数 |
| `AT+CMGR=<index>` | 读取第 N 条短信 |
| `AT+CMGD=<index>` | 删除第 N 条短信 |

### 快速发短信脚本

```bash
/home/ai/.openclaw/workspace/scripts/4g-sms <号码> <内容>

# 示例
/home/ai/.openclaw/workspace/scripts/4g-sms 18180805696 "Test message"
```

---

## 五、AT+CMGS 操作关键注意事项

> 来自官方 Wiki，操作失败率高的根本原因

1. **必须先关闭 URC 干扰**：
   ```bash
   AT+CREG=0
   AT+CEREG=0
   AT+CNMI=0,0,0,0,0
   ```
   否则网络主动上报（`+CGEV`、`+CEREG` 等）会混入串口缓冲区，导致收不到 `>` 提示符。

2. **发送内容后不要按回车**，直接发送 `0x1A`（Ctrl+Z）结束。

3. **等待时间要足够**：`AT+CMGS="号码"` 后等待 **5 秒** 再检查 `>` 提示符。

---

## 六、省电与睡眠模式

| 命令 | 模式 |
|------|------|
| `AT+CFUN=0` | 最小功能（最低功耗）|
| `AT+CFUN=1` | 全功能（正常模式）|
| `AT+CFUN=4` | 飞行模式（射频关闭，串口可用）|
| `AT+CSCLK=1` | DTR 睡眠模式 |
| `AT+CSCLK=2` | RX 睡眠模式（串口唤醒）|

---

## 七、MQTT 连接

| 步骤 | 命令 |
|------|------|
| 启动 MQTT | `AT+CMQTTSTART` |
| 获取客户端 | `AT+CMQTTACCQ=0,"<client_id>",0`（0=TCP，1=SSL/TLS）|
| 连接服务器 | `AT+CMQTTCONNECT=0,"tcp://<host>:<port>",<keepalive>,1,"<user>","<pwd>"` |
| 订阅主题 | `AT+CMQTTSUB=0,<topic_len>,0` → 输入主题 |
| 发布消息 | `AT+CMQTTTOPIC=0,<len>` → 主题 → `AT+CMQTTPAYLOAD=0,<len>` → 内容 → `AT+CMQTTPUB=0,,<timeout>` |
| 断开连接 | `AT+CMQTTDISC=0,120` |

---

## 八、常见返回值

| 返回值 | 意义 |
|--------|------|
| `OK` | 命令执行成功 |
| `ERROR` | 无效命令或失败 |
| `VOICE CALL: BEGIN` | 通话开始 |
| `VOICE CALL: END` | 通话结束 |
| `NO CARRIER` | 无载波（通话断开）|
| `RING` | 来电响铃 |
| `+COLP: "<number>"` | 被叫号码确认 |
| `+CLCC: ...` | 当前通话列表 |

---

## 九、已知问题与限制

| 问题 | 说明 | 解决方案 |
|------|------|---------|
| CREG=0 但电话可打通 | VoLTE 语音走 IMS，不依赖 CREG | 正常，直接 ATD 拨号即可 |
| PDU 模式报 "Invalid PDU mode parameter" | A7670G 固件 PDU 解析有问题 | 使用文本模式（英文）|
| 中文短信乱码/失败 | 文本模式不支持 UTF-8，PDU 模式固件限制 | 换用英文，或更换模块 |
| AT 命令响应慢/被 URC 打断 | 串口缓冲区被主动上报污染 | 先发送 `AT+CREG=0` 等关闭 URC |

---

## 十、相关文件

- 脚本：`/home/ai/.openclaw/workspace/scripts/4g-call`
- 脚本：`/home/ai/.openclaw/workspace/scripts/4g-sms`
- 模块固件：SIMCOM A7670G-LLSE
- AT 命令端口：`/dev/ttyUSB2`
- 参考资料：https://wiki.dfrobot.com.cn/_SKU_TEL0163_A7670G_CAT1_4G_通信模块
