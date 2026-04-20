# 安全系统

## 基本信息
- **类型**：安全软件集群
- **状态**：✅ 运行中

## 组成
| 软件 | 版本 | 用途 |
|------|------|------|
| OSSEC HIDS | 4.0.0 | 入侵检测系统 |
| fail2ban | 0.7.10-2 | 自动封禁恶意 IP |
| UFW | 0.36.2 | 防火墙 |

## 检查命令
```bash
bash /home/ai/.openclaw/workspace/scripts/security-check.sh
```
> 用户说"检查安全"时调用

## 配置路径
```
~/.config/security/
├── README.md
├── INSTALLED-APPS.md
├── ossec/
├── fail2ban/
├── ufw/
└── notes/
```
