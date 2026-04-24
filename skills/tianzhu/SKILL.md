---
name: tianzhu
description: 天诛系统状态查询。当用户提及"天诛"、"天诛系统"、"查看天诛状态"、"天诛健康状态"时触发。显示天诛系统所有节点的实时状态。
user-invocable: true
metadata: {"openclaw": {"emoji": "⚡", "os": ["linux"]}}
---

# 天诛系统（TianZhu Automated Defense）

> 主人可随时通过说"天诛"或"天诛状态"唤起本技能。

## 功能

展示天诛系统所有组件的实时状态。

## 执行

```bash
echo "=== 天诛系统状态 ==="
echo "--- PM2 ---"
pm2 list | grep -E "tianzhu|cowrie|beelzebub" || true
echo "--- fail2ban ---"
sudo fail2ban-client status 2>/dev/null | head -5
echo "--- Cron ---"
crontab -l 2>/dev/null | grep tianzhu
echo "--- Health Log ---"
tail -20 /home/ai/projects/tianxing-defense/logs/tianzhu-health-*.log 2>/dev/null | tail -10 || echo "暂无健康检查日志"
```

## 输出说明

- **tianzhu-daemon**：主守护进程，监听 fail2ban 事件 + Cowrie 日志
- **Cowrie**：SSH/Telnet 蜜罐，端口 2222/2223
- **Beelzebub**：HTTP 蜜罐，端口 8080
- **fail2ban**：入侵检测封锁（7个 jail）
- **健康检查 cron**：每2小时自动检查

## 法律授权

主席绝密令（内部绝密编号001）| 国安（内部绝密编号001）
