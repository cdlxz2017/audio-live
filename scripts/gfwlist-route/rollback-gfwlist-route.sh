#!/bin/bash
# GFWList 分流完整回退脚本
set -e

echo "[回退] 清理 GFWList 策略路由..."

# 停止 dnsmasq
sudo pkill -f "dnsmasq.*gfwlist" 2>/dev/null || true

# 恢复 systemd-resolved DNS
sudo tee /etc/systemd/resolved.conf > /dev/null << 'RESOLVE'
[Resolve]
RESOLVE
sudo systemctl restart systemd-resolved

# 清理 iptables
sudo iptables -t mangle -F OUTPUT 2>/dev/null || true
sudo iptables -t nat -D POSTROUTING -m mark --mark 1 -o ppp0 -j MASQUERADE 2>/dev/null || true

# 清理 ip rule
sudo ip rule del fwmark 1 table gfwroute 2>/dev/null || true
sudo ip rule del from 10.51.40.41 table gfwroute 2>/dev/null || true

# 清空 ipset
sudo ipset destroy gfwlist 2>/dev/null || true

# 清空 gfwroute 表
sudo ip route flush table gfwroute 2>/dev/null || true
sudo sed -i '/^200 gfwroute$/d' /etc/iproute2/rt_tables 2>/dev/null || true

# 清理配置文件
sudo rm -f /etc/dnsmasq.d/gfwlist.conf /etc/gfwlist/dnsmasq-gfwlist.conf
sudo rm -rf /etc/dnsmasq.d/gfwlist-domains/

echo "[回退] 完成！系统恢复原状。"
echo "提示：手动执行 'ip route show' 确认路由恢复。"
