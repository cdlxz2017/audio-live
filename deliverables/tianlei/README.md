# ⚡ 天雷系统（TianLei System）

> 专业级全流程渗透测试自动化框架

## 概述

天雷系统提供从侦察、扫描、渗透到后渗透和报告生成的完整自动化流程。
所有脚本均为完整可执行代码，非伪代码。

## 目录结构

```
tianlei/
├── README.md                    ← 本文件
├── config/
│   └── target.conf              ← 目标配置（必填）
├── 01-recon/
│   ├── recon.sh                 ← 侦察阶段主入口
│   ├── passive.py               ← 被动信息收集
│   └── active.sh                ← 主动端口/服务扫描
├── 02-scan/
│   ├── vuln-scan.sh             ← 漏洞扫描（Nmap + Nuclei + CVE检查）
│   ├── web-scan.sh              ← Web应用扫描
│   ├── api-scan.sh              ← API接口扫描
│   └── db-scan.sh               ← 数据库安全扫描
├── 03-exploit/
│   ├── exploit.sh               ← 渗透利用主入口
│   ├── waf-bypass.sh            ← WAF绕过
│   ├── web-exploit.py           ← Web漏洞利用（SQL注入等）
│   └── host-exploit.sh          ← 主机渗透利用
├── 04-post-exploit/
│   ├── post-exploit.sh          ← 后渗透主入口
│   ├── privesc-linux.sh         ← Linux提权
│   ├── privesc-windows.sh       ← Windows提权
│   ├── lateral.sh               ← 横向移动
│   └── cleanup.sh               ← 痕迹清理
├── 05-report/
│   └── report-gen.py            ← 自动报告生成
├── run-all.sh                   ← 一键全流程执行
└── utils/
    ├── common.sh                ← 公共函数库
    ├── logger.sh                ← 日志模块
    └── nmap-parse.py            ← Nmap结果解析
```

## 前置条件

### 系统要求
- Linux (Debian/Ubuntu/Kali 推荐)
- Bash 5.0+
- Python 3.8+
- Root 或 sudo 权限（部分工具需要）

### 必须安装的工具
```bash
# Debian/Ubuntu/Kali
sudo apt install -y nmap nikto sqlmap hydra nuclei subfinder amass dnsrecon

# Python 依赖
pip3 install requests beautifulsoup4 lxml jinja2 python-nmap
```

### 可选工具（增强功能）
- `metasploit-framework` — 已知CVE利用
- `searchsploit` — Exploit-DB搜索
- `gowitness` — Web截图
- `whatweb` — Web指纹识别
- `dirb/dirbuster` — 目录爆破

## 使用方法

### 方式一：一键全流程
```bash
./run-all.sh
```

### 方式二：分步执行
```bash
# 1. 编辑配置文件
vim config/target.conf

# 2. 侦察阶段
./01-recon/recon.sh

# 3. 漏洞扫描
./02-scan/vuln-scan.sh
./02-scan/web-scan.sh
./02-scan/api-scan.sh
./02-scan/db-scan.sh

# 4. 渗透利用
./03-exploit/exploit.sh

# 5. 后渗透
./04-post-exploit/post-exploit.sh

# 6. 生成报告
./05-report/report-gen.py
```

## 配置说明

编辑 `config/target.conf`：

```bash
# 必填：项目名称和授权文件路径
PROJECT_NAME="MyProject"
AUTH_FILE="/path/to/authorization.pdf"

# 必填：目标（三选一或组合）
TARGET_SUBNETS="192.168.1.0/24"
TARGET_DOMAINS="example.com"
TARGET_IPS="10.0.0.1 10.0.0.2"

# 可选：排除地址、超时、线程数等
EXCLUDE_HOSTS=""
TIMEOUT=300
THREADS=10
```

## 输出结构

所有结果保存在 `results/<project>/<date>/` 下：

```
results/MyProject/2026-04-15/
├── recon/          ← 侦察结果
├── scan/           ← 扫描结果
├── exploit/        ← 利用结果
├── post-exploit/   ← 后渗透结果
├── report/         ← 最终报告
└── pentest.log     ← 全流程日志
```

## 安全声明

1. **授权优先**：所有脚本执行前会验证授权文件存在
2. **范围限制**：仅在配置的目标范围内执行操作
3. **日志记录**：所有操作均有完整日志记录
4. **痕迹清理**：测试完成后使用 cleanup.sh 清理痕迹
5. **法律合规**：仅在获得书面授权的情况下使用本工具

## 注意事项

- 工具不存在时会提示安装并跳过该步骤，不会中断流程
- 每个阶段的失败不会影响其他阶段继续执行
- 报告生成会读取所有阶段的 JSON 结果文件
- 建议在隔离的测试环境中首次运行

## 许可证

仅供授权的安全测试使用。未经授权的使用是非法的。

---

*天雷系统 — 雷霆万钧，无所不至 ⚡*
