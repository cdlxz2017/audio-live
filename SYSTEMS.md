# 系统注册表 — 触发词：系统 / 调用 / 触发 / 所有系统 / 系统清单

> 输入以下关键词任一，即输出完整系统清单和使用方法
> 触发词不区分大小写

---

## 通讯与语音

### 4G语音通讯系统 v2
- **触发词**：语音、打电话、拨号、SMS、短信、通讯录
- **CLI命令**：
  ```bash
  cd /home/ai/.openclaw/workspace/voice-system/v2
  python3 cli/voice_cli.py contact list          # 查看通讯录
  python3 cli/voice_cli.py call <手机号>        # 发起外呼
  python3 cli/voice_cli.py sms <手机号> <内容>  # 发送短信
  python3 cli/voice_cli.py broadcast <标签> <内容>  # 群发短信
  python3 cli/voice_cli.py contact add <手机号> <姓名> [标签]  # 添加联系人
  ```
- **微信推送**：来电/录音完成后自动推送到微信
- **录音设备**：自动检测（plughw:1,0）
- **状态**：✅ 运行中（PM2）

---

### 远程录音系统（Audio Stream）
- **触发词**：远程录音、开始录音、停止录音、录音状态
- **使用**：
  ```bash
  python3 /home/ai/.openclaw/workspace/custom-skills/camera-recorder/scripts/camera.py start   # 开始
  python3 /home/ai/.openclaw/workspace/custom-skills/camera-recorder/scripts/camera.py stop    # 停止
  python3 /home/ai/.openclaw/workspace/custom-skills/camera-recorder/scripts/camera.py status  # 状态
  ```
- **手机访问**：https://192.168.31.200:18792/audio-live.html
- **自动流程**：录音 → Whisper转写 → LLM摘要 → 邮件发送
- **状态**：✅ 运行中

---

## 记忆与知识

### 记忆系统
- **触发词**：记忆系统、检查记忆、health check
- **使用**：
  ```bash
  node /home/ai/.openclaw/workspace/memory-system/scripts/health-check.js
  node /home/ai/.openclaw/workspace/memory-system/scripts/system-deep-inspector.js
  ```
- **包含**：session-extractor、graph-linker、summary-extractor、SelfHealer、AutoMonitor
- **端口**：18789（Gateway）/ 31234（Graphify Query）
- **状态**：✅ 运行中（6/6进程）

---

### 自我监控系统
- **触发词**：健康检查、巡检、自动监控、系统状态
- **使用**：
  ```bash
  bash /home/ai/.openclaw/workspace/scripts/security-check.sh   # 安全检查（UFW/OSSEC/fail2ban）
  bash /home/ai/.openclaw/workspace/scripts/comprehensive-health-check.js
  ```
- **自动**：每4小时cron自动巡检，异常自动告警到微信
- **状态**：✅ 运行中

---

### 技术知识库（Tech Knowledge）
- **触发词**：技术知识、tech-knowledge、查技术文档
- **使用**：告诉我要查什么技术主题，自动从知识库检索
- **覆盖**：SOP文档 / memory-system架构 / a2a-gateway / lingyi-cms
- **方式**：向量搜索（BGE-m3）+ PostgreSQL全文检索
- **状态**：✅ 可用

---

### 目标追踪系统（Goal Tracker）
- **触发词**：目标追踪、Goal Tracker、当前目标、任务进度
- **使用**：告诉我要追踪什么项目/任务，自动创建Goal + SubGoal + Milestone
- **查看**：`memory/AGI-SYSTEM-DEEP-ANALYSIS-2026-04-14.md`
- **状态**：✅ Neo4j中运行

---

### 反思系统
- **触发词**：反思、元认知、今日反思
- **自动**：每天23:00自动生成反思摘要
- **输出路径**：`memory/reflection/YYYY-MM-DD.md`
- **状态**：✅ 已修复（评分门槛已调整）

---

## 天道·系统（Tiandao Microservices）

- **触发词**：天道、系统后台、民宿管理
- **管理后台**：http://localhost:3003
- **服务端口**：
  | 服务 | 端口 | 说明 |
  |------|------|------|
  | tiandao-member | 3002 | 成员管理 |
  | tiandao-auth | 3004 | 认证服务 |
  | tiandao-karma | 3007 | 业力系统 |
  | tiandao-worldevent | 3011 | 现实事件接入 |
  | tiandao-admin-app | 3013 | 管理后台API |
- **状态**：✅ 运行中（PM2）

---

## 邮件系统

- **触发词**：发邮件、发送邮件、测试邮件
- **发送**：
  ```bash
  node /home/ai/.openclaw/workspace/custom-skills/send-email/scripts/send-mail.js \
    --to cdlxz2017@qq.com --subject "标题" --body "内容"
  ```
- **配置**：SMTP smtp.qq.com:587 / 授权码已配置
- **状态**：✅ 正常

---

## Hermes Agent（玄一）

- **触发词**：玄一、Hermes、深度分析
- **使用**：告诉我需要分析什么，自动调用Hermes执行
- **工具**：recall_memories / search_memories / write_memory / neo4j_query / graph_query
- **调用方式**：
  ```javascript
  node /home/ai/.openclaw/workspace/custom-skills/hermes-router/hermes-router.js
  ```
- **状态**：✅ Phase 1-3已完成

---

## 安全系统

### OSSEC HIDS（主机入侵检测）
- **用途**：文件完整性检查、rootkit检测、异常行为告警、Active Response自动封禁
- **进程**：✅ 6个进程运行中
- **配置路径**：`/var/ossec/etc/ossec.conf`
- **管理命令**：`/var/ossec/bin/ossec-control status`
- **日志路径**：`/var/ossec/logs/`
- **告警邮件**：cdlxz2017@qq.com
- **Active Response**：firewall-drop (iptables封禁600秒)
- **状态**：✅ 运行中

### fail2ban（暴力破解防护）
- **用途**：SSH/服务登录暴力破解防护
- **进程**：✅ fail2ban-server 运行中
- **状态**：✅ 运行中

### UFW 防火墙
- **状态**：✅ 已激活
- **入站规则**：
  - 允许 192.168.31.0/24（内网）
  - 允许 172.17.0.0/16（Docker）
  - 允许 127.0.0.0/8（本地）
  - 允许 18790/tcp（OpenClaw）
  - 允许 3001,8001/tcp（Tailscale）
  - 允许 41641/udp（Tailscale tunnel）
  - 允许 5256/tcp（Tailscale serve）
  - 拒绝 USB网络接口（enxae0c29a39b6d）入站

### 蜜罐防御系统（Honeypot Defense）
- **用途**：诱捕攻击者、记录攻击行为、联动天刑系统
- **组件**：
  - **Cowrie SSH/Telnet 蜜罐**：端口 2222/2223，捕获恶意SSH登录
  - **Python HTTP 蜜罐**：端口 8080，伪装 Apache/2.4.41，提供/admin、/api/status等诱饵路径
  - **天刑联动**：cowrie-tianxing PM2进程，攻击事件自动触发IP扫描
  - **fail2ban 联动**：cowrie-ssh / cowrie-telnet jail，登录失败自动封禁
- **PM2 进程**：
  | 进程 | 端口 | 状态 |
  |------|------|------|
  | cowrie-ssh | 2222 | ✅ online |
  | cowrie-tianxing | — | ✅ online |
  | beelzebub-http | 8080 | ✅ online |
- **UFW 规则**：2222/tcp、2223/tcp、8080/tcp 已放行
- **SSH 指纹**：与真实系统 OpenSSH_9.6p1 对齐
- **日志路径**：
  - Cowrie：`/home/ai/services/honeypot/cowrie-src/var/log/cowrie/`
  - HTTP蜜罐：`/home/ai/services/honeypot/beelzebub.log`
- **scan-ip.sh**：`/home/ai/projects/tianxing-defense/scripts/scan-ip.sh`
- **Goal追踪**：Neo4j Goal honeypot-defense-2026 ✅ 100% 完成
- **状态**：✅ 全部部署完成并验证通过

### 天雷系统（TianLei Penetration Testing System）⚡
- **用途**：专业级全流程渗透测试自动化框架，从侦察、扫描、渗透到后渗透和报告生成
- **触发词**：天雷、渗透测试、天雷系统、pentest
- **路径**：`/home/ai/.openclaw/workspace/deliverables/tianlei/`
- **一键执行**：
  ```bash
  cd /home/ai/.openclaw/workspace/deliverables/tianlei
  ./run-all.sh                    # 交互式一键全流程
  ```
- **分步执行**：
  ```bash
  ./01-recon/recon.sh             # 阶段1：侦察（被动+主动）
  ./02-scan/vuln-scan.sh          # 阶段2：漏洞扫描（Nmap+Nuclei+CVE）
  ./02-scan/web-scan.sh           # Web应用扫描
  ./02-scan/api-scan.sh           # API接口扫描
  ./02-scan/db-scan.sh            # 数据库扫描
  ./03-exploit/exploit.sh         # 阶段3：渗透利用
  ./03-exploit/waf-bypass.sh      # WAF绕过
  ./03-exploit/web-exploit.py     # Web漏洞利用（SQL注入等）
  ./03-exploit/host-exploit.sh    # 主机渗透
  ./04-post-exploit/post-exploit.sh  # 阶段4：后渗透
  ./04-post-exploit/privesc-linux.sh  # Linux提权
  ./04-post-exploit/privesc-windows.sh # Windows提权
  ./04-post-exploit/lateral.sh    # 横向移动
  ./04-post-exploit/cleanup.sh    # 痕迹清理
  python3 ./05-report/report-gen.py  # 阶段5：生成HTML/Markdown报告
  ```
- **配置**：编辑 `config/target.conf` 设置目标网段/域名/IP和授权文件路径
- **输出**：`results/<project>/<date>/` 下按阶段分类，含漏洞JSON和HTML报告
- **特性**：
  - 授权文件验证（执行前强制检查）
  - 工具缺失自动提示并跳过
  - 彩色日志 + 文件日志双输出
  - 自动HTML报告（含CVSS评分、修复建议、统计图表）
  - 痕迹清理（远程主机+本地）
- **脚本数**：23个完整可执行脚本，约5,800行代码
- **状态**：✅ 已部署

### 安全检查脚本
```bash
bash /home/ai/.openclaw/workspace/scripts/security-check.sh
```
- **检查内容**：UFW状态 / OSSEC状态 / fail2ban状态 / 登录失败日志
- **触发词**：安全检查、系统安全

---

## 标准操作流程（SOP）

> 所有 SOP 均可在 `/home/ai/.openclaw/workspace/` 目录下找到

### 记忆系统工作流 SOP（强制）
- **触发词**：记忆系统、修复记忆、检查记忆系统
- **规则**：记忆系统问题 → 必须用 Claude Opus 4-6 子程序处理
- **重试**：失败立即重试，最多3次；3次失败后报告主人
- **路径**：`SOP-MEMORY-SYSTEM.md`

### 邮件收发 SOP
- **触发词**：发邮件、发送邮件、测试邮件
- **路径**：`SOP-EMAIL.md`
- **发送**：`python3 custom-skills/send-email/scripts/send-email.py --to <邮箱> --subject "标题" --body "内容"`

### 视频录制 SOP
- **触发词**：摄像头、录制、开始录制、停止录制
- **路径**：`SOP-VIDEO-RECORDING.md`
- **命令**：
  ```bash
  python3 custom-skills/camera-recorder/scripts/camera.py start   # 开始录制
  python3 custom-skills/camera-recorder/scripts/camera.py stop    # 停止
  python3 custom-skills/camera-recorder/scripts/camera.py status  # 状态
  ```

### 系统清洁 SOP
- **触发词**：清洁系统、清理空间、卸载软件
- **路径**：`SOP-CLEAN-SYSTEM.md`

### Gateway 重启 SOP
- **触发词**：重启Gateway、重启网关
- **路径**：`SOP-GATEWAY-RESTART.md`
- **禁止**：禁止用 systemctl restart openclaw-gateway（会SIGTERM）
- **正确**：`openclaw gateway restart` 或 `gateway tool action=restart`

### 系统修改 SOP
- **触发词**：修改系统、更改配置
- **路径**：`SOP-SYSTEM-MODIFICATION.md`

### 故障分析 SOP（深度链路分析法）
- **触发词**：故障分析、深度分析、数据链路、追根溯源
- **核心原则**：每个故障/信息点必须绘制完整数据链路图，找出所有关联点
- **五步法**：锁定信息点 → 绘制链路图 → 识别关联点 → 评估影响 → 制定根因方案
- **路径**：`SOP-FAULT-ANALYSIS.md`
- **禁止**：跳步分析、凭感觉修改、半成品输出

---

## AI 创作

### ComfyUI（图像生成）
- **触发词**：ComfyUI、图像生成、AI画图、画图
- **WebUI**：http://192.168.31.200:8188
- **版本**：v0.19.0
- **PyTorch**：2.6.0+rocm6.2.4
- **GPU**：AMD Radeon 8060S (gfx1151)，64GB VRAM
- **节点数**：674 个
- **PM2 管理**：
  ```bash
  pm2 start comfyui    # 启动
  pm2 stop comfyui     # 停止
  pm2 logs comfyui     # 查看日志
  pm2 restart comfyui  # 重启
  ```
- **路径**：`/home/ai/ComfyUI`
- **模型路径**：`/home/ai/ComfyUI/models`
- **兼容模式**：HSA_OVERRIDE_GFX_VERSION=11.0.0（RDNA4 → RDNA3 内核）
- **状态**：✅ 运行中（PM2 #26）

---

## 工具脚本

### 系统安全检查
```bash
bash /home/ai/.openclaw/workspace/scripts/security-check.sh
```

### 记忆系统深度检查
```bash
node /home/ai/.openclaw/workspace/memory-system/scripts/system-deep-inspector.js
```

### Git 提交（配置文件变更）
```bash
cd ~/.config && git add . && git commit -m "描述"
```

---

## 硬件设备

| 设备 | 接口/地址 |
|------|----------|
| 4G模块 AT命令口 | /dev/ttyUSB1（自动检测）|
| 4G模块 短信口 | /dev/ttyUSB2（自动检测）|
| 录音设备 | plughw:1,0（自动检测）|
| TTS播放设备 | plughw:0,3 HDMI（自动检测）|
| 摄像头 | OBSBOT Tiny 2（USB）|

---

## 所有系统状态总览

| 系统 | 状态 |
|------|------|
| 4G语音v2 | ✅ 运行中 |
| 远程录音 | ✅ 运行中 |
| 记忆系统 | ✅ 运行中（6/6进程）|
| 自我监控 | ✅ 运行中 |
| 邮件系统 | ✅ 正常 |
| 天道·系统 | ✅ 运行中（5服务）|
| Hermes Agent | ✅ 可用 |
| Goal Tracker | ✅ 可用 |
| 反思系统 | ✅ 已修复 |
| Tech Knowledge | ✅ 可用 |
| OSSEC HIDS | ✅ 运行中（6进程）|
| fail2ban | ✅ 运行中 |
| UFW 防火墙 | ✅ 已激活 |
| 蜜罐防御系统 | ✅ 全部生效 |
| 天雷系统 | ✅ 已部署 |
| ComfyUI | ✅ 运行中（PM2 #26）|
| SOP文档 | ✅ 7份可用 |

---

_最后更新：2026-04-15_
